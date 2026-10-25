import {createReadStream, writeSync} from "node:fs";

interface Session {parent?: string; targetId: string; browser?: boolean; discover?: boolean; auto?: boolean; wait?: boolean; automatic?: boolean}
let buffer = "", target = 0, session = 0, loader = 0;
const targets = new Map<string, any>([["owned", {targetId: "owned", type: "page", url: "about:blank", title: "Fixture", attached: false, canAccessOpener: false}]]);
const sessions = new Map<string, Session>([["root", {targetId: "browser", browser: true}]]);
const paused = new Map<string, Set<string>>();
const deferred: any[] = [];
const send = (message: any) => writeSync(4, JSON.stringify(message) + "\0");
const frame = (owner: string, message: any) => send({...message, ...(owner !== "root" ? {sessionId: owner} : {})});
const reply = (message: any, result: any) => frame(message.sessionId ?? "root", {id: message.id, result});
const reject = (message: any, error: string) => frame(message.sessionId ?? "root", {id: message.id, error: {code: -32000, message: error}});
if (process.argv.includes("--malformed-startup")) send(null);
function attach(owner: string, info: any, automatic = false, waiting = false): string {
  const id = `${info.type === "browser" ? "browser-session" : automatic ? "auto" : "session"}-${++session}`;
  sessions.set(id, {parent: owner, targetId: info.targetId, browser: info.type === "browser", automatic});
  if (waiting) {
    if (!paused.has(info.targetId)) paused.set(info.targetId, new Set());
    paused.get(info.targetId)!.add(id);
  }
  frame(owner, {method: "Target.attachedToTarget", params: {sessionId: id, targetInfo: info, waitingForDebugger: waiting}});
  return id;
}
function detach(id: string): void {
  const node = sessions.get(id);
  if (!node) return;
  for (const [child, state] of sessions) if (state.parent === id) detach(child);
  sessions.delete(id);
  paused.get(node.targetId)?.delete(id);
  frame(node.parent!, {method: "Target.detachedFromTarget", params: {sessionId: id, targetId: node.targetId}});
}
function autoAttach(owner: string, info: any, waiting: boolean): void {
  if ([...sessions.values()].some(node => node.parent === owner && node.targetId === info.targetId && node.automatic)) return;
  attach(owner, info, true, waiting);
}
function announce(info: any): void {
  for (const [owner, node] of [...sessions]) {
    if (node.discover) frame(owner, {method: "Target.targetCreated", params: {targetInfo: info}});
    if (node.browser && node.auto) autoAttach(owner, info, node.wait === true);
  }
}
function flush(): void {
  for (let index = deferred.length - 1; index >= 0; index--) {
    const message = deferred[index], node = sessions.get(message.sessionId);
    if (!node || !paused.get(node.targetId)?.size) {
      deferred.splice(index, 1);
      if (node) handle(message);
    }
  }
}
function handle(message: any): void {
  const owner = message.sessionId ?? "root", node = sessions.get(owner);
  if (!node) { reject(message, "Session not found"); return; }
  if (message.id > 0 && message.method === "Browser.getVersion" && process.argv.includes("--malformed-runtime")) { send(null); return; }
  if (["Page.navigate", "Page.reload"].includes(message.method) && paused.get(node.targetId)?.size) { deferred.push(message); return; }
  let result: any = {}, event: (() => void) | undefined;
  switch (message.method) {
    case "Browser.close": process.exit(0);
    case "Browser.getVersion": result = {product: "Chrome/134.0.0.0", userAgent: "fixture", protocolVersion: "1.3"}; break;
    case "Target.attachToBrowserTarget":
      result = {sessionId: attach(owner, {targetId: `browser-${session + 1}`, type: "browser", url: "", title: "", attached: true})}; break;
    case "Target.detachFromTarget":
      if (sessions.get(message.params.sessionId)?.parent !== owner) { reject(message, "Session not owned by parent"); return; }
      detach(message.params.sessionId); event = flush; break;
    case "Target.getBrowserContexts": result = {browserContextIds: []}; break;
    case "Target.getTargets": result = {targetInfos: [...targets.values()]}; break;
    case "Target.getTargetInfo": result = {targetInfo: targets.get(message.params.targetId)}; break;
    case "Target.setDiscoverTargets":
      node.discover = message.params.discover;
      event = () => { if (node.discover) for (const info of targets.values()) frame(owner, {method: "Target.targetCreated", params: {targetInfo: info}}); };
      break;
    case "Target.setAutoAttach":
      node.auto = message.params.autoAttach; node.wait = message.params.waitForDebuggerOnStart;
      event = () => {
        if (node.auto && node.browser) for (const info of targets.values()) autoAttach(owner, info, false);
        if (!node.auto) for (const [id, child] of [...sessions]) if (child.parent === owner && child.automatic) detach(id);
        flush();
      };
      break;
    case "Target.createTarget": {
      const targetId = `created-${++target}`;
      const info = {targetId, type: "page", url: "about:blank", title: "Fixture", attached: false, canAccessOpener: false};
      targets.set(targetId, info); result = {targetId}; event = () => announce(info); break;
    }
    case "Target.attachToTarget": {
      const info = targets.get(message.params.targetId);
      if (!info) { reject(message, "Target not found"); return; }
      result = {sessionId: attach(owner, info)}; break;
    }
    case "Target.closeTarget": {
      const targetId = message.params.targetId;
      result = {success: targets.delete(targetId)};
      event = () => {
        for (const [id, child] of [...sessions]) if (child.targetId === targetId) detach(id);
        for (const [id, child] of sessions) if (child.discover) frame(id, {method: "Target.targetDestroyed", params: {targetId}});
        flush();
      };
      break;
    }
    case "Runtime.runIfWaitingForDebugger": paused.get(node.targetId)?.delete(owner); event = flush; break;
    case "Page.navigate":
    case "Page.reload": {
      const info = targets.get(node.targetId);
      if (!info) { reject(message, "Page not found"); return; }
      if (message.method === "Page.navigate") info.url = message.params.url;
      result = message.method === "Page.navigate" ? {frameId: "frame", loaderId: `loader-${++loader}`} : {};
      event = () => {
        frame(owner, {method: "Page.frameNavigated", params: {frame: {id: "frame", url: info.url}}});
        frame(owner, {method: "Page.domContentEventFired", params: {timestamp: 1}});
      };
      break;
    }
    case "Page.getFrameTree": result = {frameTree: {frame: {id: "frame", loaderId: "loader", url: targets.get(node.targetId)?.url ?? "about:blank", securityOrigin: "http://127.0.0.1", mimeType: "text/html"}}}; break;
    case "DOM.getDocument": result = {root: {nodeId: 1}}; break;
    case "DOM.querySelectorAll": result = {nodeIds: [2]}; break;
    case "DOM.describeNode": result = {node: {localName: "input", attributes: ["id", "fixture", "type", "text", "value", "PRIVATE INPUT"]}}; break;
    case "Runtime.evaluate": result = {result: {value: {fixture: true}}}; break;
    case "Page.captureScreenshot": result = {data: Buffer.from("fixture-image").toString("base64")}; break;
  }
  reply(message, result);
  event?.();
}
const stream = createReadStream("", {fd: 3, autoClose: false, encoding: "utf8"});
stream.on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    handle(message);
  }
});
