import {expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {connectGuardedBrowser, FOCUS_PROTOCOL} from "./client.js";

type Reply = (result?: any, loaded?: boolean) => void;
type Intercept = (command: any, reply: Reply, socket: {send(message: string): unknown}) => boolean;
async function fixture(run: (context: {page: any; requests: any[]; intercept(hook: Intercept): void; later(action: () => void, ms: number): void; timerPath: string}) => Promise<void>): Promise<void> {
  const runtime = mkdtempSync(join(tmpdir(), "focus-client-deadline-")), timerPath = join(runtime, "timer");
  const previous = process.env.BROWSER_SESSION_GUARD_STATE;
  process.env.BROWSER_SESSION_GUARD_STATE = timerPath;
  writeFileSync(timerPath, `${Date.now()}\t1`);
  const requests: any[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  let hook: Intercept = () => false;
  const server = Bun.serve({hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname.endsWith("/json/version")) return Response.json({focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", interactionMode: "foreground", webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/fixture/foreground`});
      if (server.upgrade(request)) return;
      return new Response("Not found", {status: 404});
    },
    websocket: {message(socket, data) {
      const command = JSON.parse(String(data));
      requests.push(command);
      const defaults = command.method === "Target.attachToTarget" ? {sessionId: "page-session"}
        : command.method === "Page.getFrameTree" ? {frameTree: {frame: {url: "http://127.0.0.1/fixture"}}}
        : command.method === "Page.navigate" ? {frameId: "frame", loaderId: "loader"} : {};
      const reply: Reply = (result = defaults, loaded = true) => {
        socket.send(JSON.stringify({id: command.id, result, ...(command.sessionId ? {sessionId: command.sessionId} : {})}));
        if (loaded && ["Page.navigate", "Page.reload"].includes(command.method)) socket.send(JSON.stringify({method: "Page.domContentEventFired", sessionId: command.sessionId, params: {timestamp: 1}}));
      };
      if (!hook(command, reply, socket)) reply();
    }},
  });
  let browser: Awaited<ReturnType<typeof connectGuardedBrowser>> | undefined;
  try {
    browser = await connectGuardedBrowser({mode: "host", focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", port: server.port,
      webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/fixture`, interactionMode: "foreground"}, runtime);
    const page = await browser.page("owned");
    requests.length = 0;
    await run({page, requests, timerPath, intercept(value) { hook = value; }, later(action, ms) {
      const timer = setTimeout(() => { timers.delete(timer); action(); }, ms);
      timers.add(timer);
    }});
  } finally {
    for (const timer of timers) clearTimeout(timer);
    await browser?.disconnect();
    server.stop(true);
    rmSync(runtime, {recursive: true, force: true});
    if (previous === undefined) delete process.env.BROWSER_SESSION_GUARD_STATE;
    else process.env.BROWSER_SESSION_GUARD_STATE = previous;
  }
}

test.each(["Page.enable", "Page.navigate", "Page.reload", "Page.getFrameTree"])("navigation deadline covers a stalled %s request without retrying", async method => {
  await fixture(async ({page, requests, intercept}) => {
    intercept(command => command.method === method);
    const started = performance.now();
    const navigation = method === "Page.reload" ? page.reload({timeout: 40}) : page.goto("http://127.0.0.1/private?secret=DISPOSABLE", {timeout: 40});
    await expect(navigation).rejects.toThrow(`${method} timed out; its outcome is uncertain`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(requests.filter(command => command.method === method)).toHaveLength(1);
  });
});

test.each(["goto", "reload"])("%s bounds the DOM-load wait with the same navigation deadline", async operation => {
  await fixture(async ({page, requests, intercept}) => {
    const method = operation === "goto" ? "Page.navigate" : "Page.reload";
    intercept((command, reply) => {
      if (command.method !== method) return false;
      reply(undefined, false); return true;
    });
    const navigation = operation === "goto" ? page.goto("http://127.0.0.1/fixture", {timeout: 40}) : page.reload({timeout: 40});
    await expect(navigation).rejects.toThrow(`${method} DOM load timed out; its outcome is uncertain`);
    expect(requests.some(command => command.method === "Page.getFrameTree")).toBe(false);
  });
});

test("navigation shares one budget across sequential protocol requests", async () => {
  await fixture(async ({page, requests, intercept, later}) => {
    intercept((_command, reply) => { later(reply, 90); return true; });
    await expect(page.goto("http://127.0.0.1/fixture", {timeout: 240})).rejects.toThrow("Page.getFrameTree timed out");
    expect(requests.map(command => command.method)).toEqual(["Page.enable", "Page.navigate", "Page.getFrameTree"]);
  });
});

test("DOMContentLoaded arriving before the navigation response is retained", async () => {
  await fixture(async ({page, intercept, later}) => {
    intercept((command, reply, socket) => {
      if (command.method !== "Page.navigate") return false;
      socket.send(JSON.stringify({method: "Page.domContentEventFired", sessionId: command.sessionId, params: {timestamp: 1}}));
      later(() => reply(undefined, false), 10); return true;
    });
    await page.goto("http://127.0.0.1/fixture", {timeout: 500});
    expect(page.url()).toBe("http://127.0.0.1/fixture");
  });
});

test("a recorded session budget bounds an in-flight navigation request", async () => {
  await fixture(async ({page, intercept, timerPath}) => {
    writeFileSync(timerPath, `${Date.now() - 59_900}\t1`);
    intercept(command => command.method === "Page.navigate");
    const started = performance.now();
    await expect(page.goto("http://127.0.0.1/fixture", {timeout: 1000})).rejects.toThrow("Page.navigate timed out");
    expect(performance.now() - started).toBeLessThan(500);
  });
});

test("late navigation responses do not trigger frame queries or replay after timeout", async () => {
  await fixture(async ({page, requests, intercept, later}) => {
    intercept((command, reply) => {
      if (command.method !== "Page.navigate") return false;
      later(reply, 70); return true;
    });
    let error: Error | undefined;
    try { await page.goto("http://127.0.0.1/private?secret=DISPOSABLE", {timeout: 30}); }
    catch (value) { error = value as Error; }
    expect(error?.message).toContain("Page.navigate timed out");
    expect(error?.message).not.toContain("DISPOSABLE");
    await Bun.sleep(100);
    expect(requests.map(command => command.method)).toEqual(["Page.enable", "Page.navigate"]);
  });
});

test("an elevated-mode denial names the passive recovery command", async () => {
  await fixture(async ({page, intercept}) => {
    intercept((command, _reply, socket) => {
      socket.send(JSON.stringify({id: command.id, error: {code: -32001, message: "denied"}})); return true;
    });
    await expect(page.goto("http://127.0.0.1/fixture", {timeout: 500})).rejects.toThrow("foreground approval may have expired, so run browser-start.js to return to passive inspection");
  });
});

test.each([0, -1, Infinity, NaN, 300_001])("invalid navigation timeout %s is rejected before dispatch", async timeout => {
  await fixture(async ({page, requests}) => {
    await expect(page.goto("http://127.0.0.1/fixture", {timeout})).rejects.toThrow("navigation timeout must be");
    expect(requests).toEqual([]);
  });
});
