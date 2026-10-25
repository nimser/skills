import {describe, expect, test} from "bun:test";
import {FocusGateway} from "./gateway.ts";
import {actions, type InteractionMode, type Lease} from "./policy.ts";

const now = 100_000;
const grant = (): Lease => ({version: 1, browserId: "fixture-browser", issuedAt: now, expiresAt: now + 60_000, targets: ["owned"], actions: [...actions], launch: false});
function fixture(readLease: () => unknown = grant, clock = () => now, timeout = 1000) {
  const sent: any[] = [];
  const gateway = new FocusGateway("fixture-browser", readLease, text => sent.push(JSON.parse(text)), clock, timeout);
  const peer = () => {
    const replies: any[] = [], closed: {code?: number; reason?: string}[] = [];
    return {replies, closed, send(text: string) { replies.push(JSON.parse(text)); }, close(code?: number, reason?: string) { closed.push({code, reason}); }};
  };
  const respond = (call: any, result: any = {}) => gateway.fromBrowser(JSON.stringify({id: call.id, result, ...(call.sessionId ? {sessionId: call.sessionId} : {})}));
  const open = (client: ReturnType<typeof peer>, root: string, mode: InteractionMode = "direct") => {
    expect(gateway.connect(client, mode)).toBe(true);
    const setup = sent.at(-1);
    expect(setup.method).toBe("Target.attachToBrowserTarget");
    expect(setup.sessionId).toBeUndefined();
    respond(setup, {sessionId: root});
  };
  const receive = (client: ReturnType<typeof peer>, method: string, params = {}, sessionId?: string, id = 7) => gateway.receive(client, JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  const finish = () => {
    const cleanup = sent.at(-1);
    expect(cleanup.method).toBe("Target.detachFromTarget");
    expect(cleanup.sessionId).toBeUndefined();
    respond(cleanup);
  };
  return {gateway, sent, peer, respond, open, receive, finish};
}

describe("connection-owned browser CDP sessions", () => {
  test("queues bounded startup commands and hides the control session from the client", () => {
    const f = fixture(), client = f.peer();
    expect(f.gateway.connect(client, "direct")).toBe(true);
    const setup = f.sent[0];
    f.receive(client, "Browser.getVersion");
    expect(f.sent).toHaveLength(1);
    expect(client.replies).toEqual([]);
    f.gateway.fromBrowser(JSON.stringify({method: "Target.attachedToTarget", params: {sessionId: "private-root", targetInfo: {targetId: "browser"}}}));
    expect(client.replies).toEqual([]);
    f.respond(setup, {sessionId: "private-root"});
    const request = f.sent.at(-1);
    expect(request.method).toBe("Browser.getVersion");
    expect(request.sessionId).toBe("private-root");
    f.respond(request, {product: "Chrome/fixture"});
    expect(client.replies).toEqual([{id: 7, result: {product: "Chrome/fixture"}}]);
  });

  test("rejects excessive startup buffering without dispatching or replaying it", () => {
    const f = fixture(), client = f.peer();
    f.gateway.connect(client, "direct");
    const setup = f.sent[0];
    f.receive(client, "Runtime.evaluate", {expression: "é".repeat(300_000)});
    f.receive(client, "Runtime.evaluate", {expression: "ç".repeat(300_000)}, undefined, 8);
    expect(client.replies.at(-1).error.code).toBe(-32001);
    f.respond(setup, {sessionId: "private-root"});
    expect(f.sent.filter(call => call.method === "Runtime.evaluate")).toHaveLength(1);
  });

  test("waits for teardown acknowledgement before reconnecting and retains only passive target ownership", async () => {
    const f = fixture(), first = f.peer(), second = f.peer();
    f.open(first, "root-one", "foreground");
    f.receive(first, "Target.createTarget", {url: "about:blank", background: true});
    f.respond(f.sent.at(-1), {targetId: "created"});
    f.gateway.disconnect(first);
    expect(f.sent.at(-1).params).toEqual({sessionId: "root-one"});
    expect(f.gateway.connect(second)).toBe(false);
    let available = false;
    const waiting = f.gateway.available().then(value => { available = value; });
    await Promise.resolve();
    expect(available).toBe(false);
    f.finish();
    await waiting;
    expect(available).toBe(true);
    f.open(second, "root-two", "background");
    f.receive(second, "Target.getTargets");
    expect(f.sent.at(-1).sessionId).toBe("root-two");
    f.respond(f.sent.at(-1), {targetInfos: [{targetId: "created"}, {targetId: "foreign"}]});
    expect(second.replies.at(-1).result.targetInfos).toEqual([{targetId: "created"}]);
    const before = f.sent.length;
    f.receive(second, "Runtime.evaluate");
    expect(f.sent).toHaveLength(before);
    expect(second.replies.at(-1).error.code).toBe(-32001);
  });

  test("does not transfer old sessions, replies or events to another direct client", () => {
    const f = fixture(), first = f.peer(), second = f.peer();
    f.open(first, "root-one");
    f.receive(first, "Target.attachToTarget", {targetId: "owned", flatten: true});
    f.respond(f.sent.at(-1), {sessionId: "old-page"});
    f.receive(first, "Runtime.evaluate", {expression: "fixture"}, "old-page");
    const late = f.sent.at(-1);
    f.gateway.disconnect(first); f.finish();
    f.open(second, "root-two");
    const before = f.sent.length;
    f.receive(second, "Runtime.evaluate", {}, "old-page");
    f.receive(second, "Runtime.evaluate", {}, "root-one", 8);
    f.receive(second, "Runtime.evaluate", {}, "root-two", 9);
    expect(f.sent).toHaveLength(before);
    expect(second.replies).toHaveLength(3);
    expect(second.replies.every(reply => reply.error?.code === -32001)).toBe(true);
    second.replies.length = 0;
    f.respond(late, {result: {value: "old"}});
    for (const sessionId of ["root-one", "old-page"]) f.gateway.fromBrowser(JSON.stringify({method: "Runtime.bindingCalled", params: {name: "fixture"}, sessionId}));
    expect(second.replies).toEqual([]);
    f.receive(second, "Browser.getVersion"); f.respond(f.sent.at(-1));
    expect(second.replies).toEqual([{id: 7, result: {}}]);
  });

  test("tracks explicit browser attachments and flattened descendant sessions", () => {
    const f = fixture(), client = f.peer();
    f.open(client, "private-root");
    f.receive(client, "Target.attachToBrowserTarget");
    f.respond(f.sent.at(-1), {sessionId: "client-browser"});
    f.receive(client, "Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true}, "client-browser");
    expect(f.sent.at(-1).sessionId).toBe("client-browser");
    f.respond(f.sent.at(-1));
    f.gateway.fromBrowser(JSON.stringify({method: "Target.attachedToTarget", sessionId: "client-browser", params: {sessionId: "child", targetInfo: {targetId: "owned"}, waitingForDebugger: true}}));
    f.gateway.fromBrowser(JSON.stringify({method: "Target.attachedToTarget", sessionId: "child", params: {sessionId: "worker", targetInfo: {targetId: "worker-target"}, waitingForDebugger: true}}));
    expect(client.replies.at(-1).sessionId).toBe("child");
    f.receive(client, "Runtime.runIfWaitingForDebugger", {}, "worker");
    expect(f.sent.at(-1).sessionId).toBe("worker");
    f.respond(f.sent.at(-1));
    f.gateway.fromBrowser(JSON.stringify({method: "Target.detachedFromTarget", sessionId: "private-root", params: {sessionId: "client-browser"}}));
    const before = f.sent.length;
    for (const session of ["client-browser", "child", "worker"]) f.receive(client, "Runtime.evaluate", {}, session);
    expect(f.sent).toHaveLength(before);
    f.gateway.disconnect(client);
    expect(f.sent.at(-1).params).toEqual({sessionId: "private-root"});
    expect(f.sent.filter(call => !call.sessionId).map(call => call.method)).toEqual(["Target.attachToBrowserTarget", "Target.detachFromTarget"]);
    f.finish();
  });

  test("disconnect during allocation tears down the late session without dispatching queued mutations", async () => {
    const f = fixture(), client = f.peer();
    f.gateway.connect(client, "direct");
    const setup = f.sent[0];
    f.receive(client, "Target.createTarget", {url: "about:blank"});
    f.gateway.disconnect(client);
    expect(f.gateway.connect(f.peer())).toBe(false);
    expect(f.sent).toHaveLength(1);
    f.respond(setup, {sessionId: "late-root"});
    expect(f.sent.at(-1).params).toEqual({sessionId: "late-root"});
    expect(f.sent.some(call => call.method === "Target.createTarget")).toBe(false);
    f.finish();
    expect(await f.gateway.available()).toBe(true);
    expect(client.replies).toEqual([]);
  });

  test.each(["revocation", "expiry", "replacement"])("idle %s retires the session without browser-wide resets or resumes", async kind => {
    let active: unknown = grant(), clock = now;
    const f = fixture(() => active, () => clock), client = f.peer();
    f.open(client, "private-root");
    f.receive(client, "Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true});
    expect(f.sent.at(-1).sessionId).toBe("private-root");
    f.respond(f.sent.at(-1));
    client.replies.length = 0;
    if (kind === "revocation") active = undefined;
    if (kind === "expiry") clock += 60_000;
    if (kind === "replacement") active = {...grant(), targets: ["other"]};
    f.gateway.checkLease();
    expect(client.closed).toHaveLength(1);
    expect(client.closed[0]!.code).toBe(1008);
    expect(f.sent.at(-1).params).toEqual({sessionId: "private-root"});
    f.gateway.fromBrowser(JSON.stringify({method: "Target.attachedToTarget", sessionId: "private-root", params: {sessionId: "late-child", targetInfo: {targetId: "foreign"}, waitingForDebugger: true}}));
    expect(client.replies).toEqual([]);
    expect(f.sent.some(call => call.method === "Runtime.runIfWaitingForDebugger")).toBe(false);
    expect(f.sent.filter(call => call.method === "Target.setAutoAttach")).toHaveLength(1);
    f.finish();
    expect(await f.gateway.available()).toBe(true);
    f.open(f.peer(), "passive-root", "background");
  });

  test("availability rechecks the previous client's approval before admitting a new connection", async () => {
    let active: unknown = grant();
    const f = fixture(() => active), client = f.peer();
    f.open(client, "private-root");
    active = undefined;
    const available = f.gateway.available();
    expect(client.closed[0]!.code).toBe(1008);
    f.finish();
    expect(await available).toBe(true);
  });

  test("expiry during allocation never flushes queued work", async () => {
    let clock = now;
    const f = fixture(grant, () => clock), client = f.peer();
    f.gateway.connect(client, "direct");
    const setup = f.sent[0];
    f.receive(client, "Target.createTarget", {url: "about:blank"});
    clock += 60_000;
    f.respond(setup, {sessionId: "expired-root"});
    expect(client.closed[0]!.code).toBe(1008);
    expect(f.sent.map(call => call.method)).toEqual(["Target.attachToBrowserTarget", "Target.detachFromTarget"]);
    f.finish();
    expect(await f.gateway.available()).toBe(true);
  });

  test.each(["allocation-error", "allocation-missing-session", "cleanup-error"])("%s permanently blocks reuse without falling back to the control root", async kind => {
    const f = fixture(), client = f.peer();
    f.gateway.connect(client, "direct");
    if (kind === "cleanup-error") { f.respond(f.sent.at(-1), {sessionId: "private-root"}); f.gateway.disconnect(client); }
    const call = f.sent.at(-1);
    f.gateway.fromBrowser(JSON.stringify({id: call.id, ...(kind === "allocation-missing-session" ? {result: {}} : {error: {code: -32000, message: "fixture failure"}})}));
    expect(await f.gateway.available()).toBe(false);
    expect(f.gateway.connect(f.peer())).toBe(false);
    expect(client.closed.at(-1)!.code).toBe(1011);
    expect(f.sent.every(call => ["Target.attachToBrowserTarget", "Target.detachFromTarget"].includes(call.method))).toBe(true);
  });

  test.each(["allocation", "cleanup"])("%s timeout blocks reuse, including after a late successful reply", async kind => {
    const f = fixture(grant, () => now, 15), client = f.peer();
    f.gateway.connect(client, "direct");
    if (kind === "cleanup") { f.respond(f.sent.at(-1), {sessionId: "private-root"}); f.gateway.disconnect(client); }
    const pending = f.sent.at(-1);
    await Bun.sleep(40);
    expect(await f.gateway.available()).toBe(false);
    f.respond(pending, kind === "allocation" ? {sessionId: "too-late"} : {});
    expect(f.gateway.connect(f.peer())).toBe(false);
    expect(client.closed.at(-1)!.code).toBe(1011);
  });

  test("unexpected control-root detach closes the peer and quarantines the transport", async () => {
    const f = fixture(), client = f.peer();
    f.open(client, "private-root");
    f.gateway.fromBrowser(JSON.stringify({method: "Target.detachedFromTarget", params: {sessionId: "private-root"}}));
    expect(client.closed[0]!.code).toBe(1011);
    expect(await f.gateway.available()).toBe(false);
  });
});
