import fs from "node:fs";
import {modeEndpoint} from "./mode.js";

export const FOCUS_PROTOCOL = "browser-tools-focus-v2";
const blocked = reason => new Error(`FOCUS_BLOCKED: ${reason}. Use passive inspection/API/CLI or explicitly request foreground/direct CDP; never upgrade automatically.`);

export function checkSessionBudget(runtime) {
  const file = process.env.BROWSER_SESSION_GUARD_STATE || `${runtime}/session-guard.state`;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT" && process.env.BROWSER_GUARD_REQUIRE_SESSION !== "1") return Infinity;
    throw blocked("session timer is unavailable");
  }
  const [start, minutes] = text.split("\t").map(Number);
  const remaining = start + minutes * 60_000 - Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(minutes) || minutes <= 0 || start > Date.now() || remaining <= 0) throw blocked("session timer is invalid or EXPIRED");
  return remaining;
}

export async function connectGuardedBrowser(state, runtime, timeoutMs = 5000) {
  if (state?.mode !== "host" || state.focusProtocol !== FOCUS_PROTOCOL || typeof state.browserId !== "string"
    || !/^[A-Za-z0-9-]{1,100}$/.test(state.browserId) || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535
    || state.webSocketDebuggerUrl !== `ws://127.0.0.1:${state.port}/devtools/browser/${state.browserId}`) {
    throw blocked("legacy or unsupported browser endpoint; deploy the private-pipe focus gateway");
  }
  checkSessionBudget(runtime);
  const endpoint = modeEndpoint(state);
  try {
    const response = await fetch(`${endpoint.browserURL}/json/version`, {signal: AbortSignal.timeout(timeoutMs)});
    const identity = await response.json();
    if (!response.ok || identity.focusProtocol !== FOCUS_PROTOCOL || identity.browserId !== state.browserId || identity.interactionMode !== endpoint.mode || identity.webSocketDebuggerUrl !== endpoint.browserWSEndpoint) throw new Error();
  } catch { throw blocked("gateway identity is unavailable or unverified; no protocol connection was opened"); }
  const socket = new WebSocket(endpoint.browserWSEndpoint);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const fail = () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(blocked("browser disconnected; sent mutations have uncertain outcomes")); }
    pending.clear();
  };
  socket.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { socket.close(); fail(); return; }
    const call = pending.get(message.id);
    if (call) {
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(message.error.code === -32001 ? blocked("selected mode, approval or operation denied by gateway") : new Error("Browser operation failed; inspect the outcome before another action"));
      else call.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  });
  socket.addEventListener("close", fail);
  socket.addEventListener("error", fail);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(blocked("gateway connection timed out")); }, timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener("error", () => { clearTimeout(timer); reject(blocked("gateway unavailable")); }, {once: true});
    socket.addEventListener("close", () => { clearTimeout(timer); reject(blocked("gateway refused the connection")); }, {once: true});
  });
  async function send(method, params = {}, sessionId) {
    checkSessionBudget(runtime);
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(blocked("gateway disconnected"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(blocked("operation timed out; its outcome is uncertain")); }, 30_000);
      pending.set(id, {resolve, reject, timer});
      socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  const session = sessionId => ({send: (method, params) => send(method, params, sessionId), detach: () => send("Target.detachFromTarget", {sessionId})});
  const pages = new Map();
  const browser = {
    wsEndpoint: () => state.webSocketDebuggerUrl,
    disconnect: async () => {
      fail();
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(blocked("gateway disconnect timed out")), 2000);
        socket.addEventListener("close", () => { clearTimeout(timer); resolve(); }, {once: true});
        socket.close();
      });
    },
    targetInfos: () => send("Target.getTargets").then(result => result.targetInfos),
    onProtocolEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    createCDPSession: async () => ({send: (method, params) => send(method, params), detach: async () => {}}),
    newOwnedPage: async () => {
      const {targetId} = await send("Target.createTarget", {url: "about:blank", background: true});
      return {page: await browser.page(targetId), targetId};
    },
    page: async targetId => {
      if (pages.has(targetId)) return pages.get(targetId);
      const {sessionId} = await send("Target.attachToTarget", {targetId, flatten: true});
      const cdp = session(sessionId);
      let currentUrl = "about:blank";
      listeners.add(message => {
        if (message.sessionId === sessionId && message.method === "Page.frameNavigated" && !message.params?.frame?.parentId) currentUrl = message.params.frame.url;
      });
      await cdp.send("Page.enable");
      const navigate = async (method, params, options = {}) => {
        if (options.waitUntil && options.waitUntil !== "domcontentloaded") throw blocked("unsupported navigation wait condition");
        await cdp.send("Page.enable");
        let complete;
        const loaded = new Promise(resolve => { complete = resolve; });
        const listener = message => { if (message.sessionId === sessionId && message.method === "Page.domContentEventFired") complete(); };
        listeners.add(listener);
        let timer;
        try {
          const result = await cdp.send(method, params);
          if (result.errorText) throw new Error("Navigation failed; do not retry automatically");
          if (method === "Page.reload" || result.loaderId) await Promise.race([loaded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Navigation timed out; inspect before another action")), options.timeout || 30_000); })]);
          const {frameTree} = await cdp.send("Page.getFrameTree");
          currentUrl = frameTree.frame.url;
        } finally { clearTimeout(timer); listeners.delete(listener); }
      };
      const page = {
        targetId,
        url: () => currentUrl,
        createCDPSession: async () => {
          const attached = await send("Target.attachToTarget", {targetId, flatten: true});
          return session(attached.sessionId);
        },
        goto: (url, options) => navigate("Page.navigate", {url}, options),
        reload: options => navigate("Page.reload", {}, options),
        bringToFront: () => cdp.send("Page.bringToFront"),
        evaluate: async (fn, ...args) => {
          const expression = typeof fn === "function" ? `(${fn.toString()})(...${JSON.stringify(args)})` : String(fn);
          const result = await cdp.send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
          if (result.exceptionDetails) throw new Error("Page evaluation failed; no automatic retry is permitted");
          return result.result?.value;
        },
        screenshot: async (options = {}) => {
          const {data} = await cdp.send("Page.captureScreenshot", {format: "png", fromSurface: true, captureBeyondViewport: false});
          const bytes = Buffer.from(data, "base64");
          if (options.path) fs.writeFileSync(options.path, bytes, {mode: 0o600});
          return bytes;
        },
        keyboard: {type: text => cdp.send("Input.insertText", {text: String(text)})},
        mouse: {click: async (x, y) => {
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error("Invalid viewport coordinates");
          await cdp.send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y});
          await cdp.send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", clickCount: 1});
          await cdp.send("Input.dispatchMouseEvent", {type: "mouseReleased", x, y, button: "left", clickCount: 1});
        }},
        authenticate: async () => { throw blocked("proxy authentication is not supported by this gateway"); },
        cookies: async () => { throw blocked("cookie export is not a supported focus capability"); },
        close: () => send("Target.closeTarget", {targetId}),
      };
      const {frameTree} = await cdp.send("Page.getFrameTree");
      currentUrl = frameTree.frame.url;
      pages.set(targetId, page);
      return page;
    },
  };
  try { await send("Browser.getVersion"); return browser; }
  catch (error) { await browser.disconnect(); throw error; }
}
