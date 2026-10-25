import {expect, test} from "bun:test";
import {spawn} from "node:child_process";
import type {Readable, Writable} from "node:stream";
import {fileURLToPath} from "node:url";

async function pipeFixture(run: (send: (method: string, params?: any, sessionId?: string) => Promise<any>, events: any[]) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [fileURLToPath(new URL("fake-browser.ts", import.meta.url))], {stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"]});
  const writer = child.stdio[3] as Writable, reader = child.stdio[4] as Readable;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const events: any[] = [], pending = new Map<number, {resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  let buffer = "", id = 0;
  reader.setEncoding("utf8");
  reader.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const call = pending.get(message.id);
      if (call) { clearTimeout(call.timer); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
      else events.push(message);
    }
  });
  const send = (method: string, params = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`Fake pipe ${method} timed out`)); }, 1000);
    pending.set(next, {resolve, reject, timer});
    writer.write(JSON.stringify({id: next, method, params, ...(sessionId ? {sessionId} : {})}) + "\0");
  });
  try { await run(send, events); }
  finally {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("Fake pipe stopped")); }
    child.kill("SIGTERM");
    await exited;
  }
}

test("fake pipe reproduces retained root auto-attachment blocking another client's navigation", async () => {
  await pipeFixture(async (send, events) => {
    await send("Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true});
    const {targetId} = await send("Target.createTarget", {url: "about:blank", background: true});
    const {sessionId} = await send("Target.attachToTarget", {targetId, flatten: true});
    let completed = false;
    const navigation = send("Page.navigate", {url: "http://127.0.0.1/fixture"}, sessionId).then(result => { completed = true; return result; });
    await Bun.sleep(30);
    expect(completed).toBe(false);
    expect(events.some(event => event.method === "Target.attachedToTarget" && event.params.waitingForDebugger)).toBe(true);
    await send("Target.setAutoAttach", {autoAttach: false, flatten: true, waitForDebuggerOnStart: false});
    expect((await navigation).loaderId).toBeString();
  });
});

test("detaching one fake browser session releases its nested debugger waits without touching another session", async () => {
  await pipeFixture(async send => {
    const {sessionId: first} = await send("Target.attachToBrowserTarget");
    const {sessionId: second} = await send("Target.attachToBrowserTarget");
    const {sessionId: nested} = await send("Target.attachToBrowserTarget", {}, first);
    await send("Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true}, nested);
    const {targetId} = await send("Target.createTarget", {url: "about:blank", background: true}, second);
    const {sessionId: page} = await send("Target.attachToTarget", {targetId, flatten: true}, second);
    let completed = false;
    const navigation = send("Page.navigate", {url: "http://127.0.0.1/fixture"}, page).then(result => { completed = true; return result; });
    await Bun.sleep(30);
    expect(completed).toBe(false);
    await send("Target.detachFromTarget", {sessionId: first});
    expect((await navigation).loaderId).toBeString();
    expect((await send("Target.getTargets", {}, second)).targetInfos.some((info: any) => info.targetId === targetId)).toBe(true);
  });
});

test("fake session teardown preserves another client's independent debugger wait", async () => {
  await pipeFixture(async (send, events) => {
    const {sessionId: first} = await send("Target.attachToBrowserTarget");
    const {sessionId: second} = await send("Target.attachToBrowserTarget");
    for (const session of [first, second]) await send("Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true}, session);
    const {targetId} = await send("Target.createTarget", {url: "about:blank", background: true});
    const {sessionId: page} = await send("Target.attachToTarget", {targetId, flatten: true}, second);
    let completed = false;
    const navigation = send("Page.navigate", {url: "http://127.0.0.1/fixture"}, page).then(result => { completed = true; return result; });
    await send("Target.detachFromTarget", {sessionId: first});
    await Bun.sleep(30);
    expect(completed).toBe(false);
    const attachment = events.find(event => event.sessionId === second && event.method === "Target.attachedToTarget" && event.params.targetInfo.targetId === targetId && event.params.waitingForDebugger);
    expect(attachment).toBeDefined();
    await send("Runtime.runIfWaitingForDebugger", {}, attachment.params.sessionId);
    expect((await navigation).loaderId).toBeString();
  });
});
