import {describe, expect, test} from "bun:test";
import {actions, FocusPolicy, parseLease, type Command, type Lease} from "./policy.ts";
import {FocusGateway} from "./gateway.ts";
import {grantArguments} from "./lease.ts";
import {validateLaunch} from "./serve.ts";

const now = 100_000;
const lease = (extra: Partial<Lease> = {}): Lease => ({version: 1, browserId: "fixture-browser", issuedAt: now, expiresAt: now + 60_000, targets: ["owned"], actions: [...actions], launch: false, ...extra});
const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Command => ({id: 1, method, params, ...(sessionId ? {sessionId} : {})});
const methods = ["Page.navigate", "Page.reload", "Target.createTarget", "Runtime.evaluate", "Runtime.callFunctionOn", "Page.captureScreenshot", "DOMSnapshot.captureSnapshot", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Target.attachToTarget", "Target.activateTarget", "Page.bringToFront"];

describe("focus capabilities fail closed before dispatch", () => {
  test.each(methods)("blocks background %s", method => {
    const sent: string[] = [], replies: string[] = [];
    const gateway = new FocusGateway("fixture-browser", () => undefined, text => sent.push(text), () => now);
    const peer = {send: (text: string) => replies.push(text), close() {}};
    gateway.connect(peer);
    gateway.receive(peer, JSON.stringify(command(method)));
    expect(sent).toEqual([]);
    expect(JSON.parse(replies[0]!).error.code).toBe(-32001);
  });

  test("rejects expired, future, malformed, excessive and wrong-browser leases", () => {
    for (const value of [undefined, {}, lease({browserId: "other"}), lease({expiresAt: now}), lease({issuedAt: now + 1}), lease({expiresAt: now + 300_001}), lease({actions: ["unknown"] as any}), lease({targets: ["*"]})]) {
      expect(() => parseLease(value, "fixture-browser", now)).toThrow("FOCUS_BLOCKED");
    }
    expect(parseLease(lease(), "fixture-browser", now)).toEqual(lease());
    expect(() => grantArguments(["--target", "owned", "--actions", "inspect", "--seconds", "301"], "fixture-browser", now)).toThrow();
    expect(() => grantArguments(["--actions", "inspect"], "fixture-browser", now)).toThrow();
    expect(grantArguments(["--launch", "--actions", "tab-create", "--seconds", "30"], "fixture-browser", now).launch).toBe(true);
  });

  test("enforces scope, session ownership, expiry and revocation on each command", () => {
    let active: unknown = lease({actions: ["inspect"]}), clock = now;
    const policy = new FocusPolicy("fixture-browser", () => active, () => clock);
    policy.sessions.set("owned-session", "owned");
    policy.sessions.set("foreign-session", "foreign");
    policy.authorize(command("DOMSnapshot.captureSnapshot", {}, "owned-session"));
    policy.observe({id: 1, result: {}});
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "owned-session"))).toThrow("javascript");
    expect(() => policy.authorize(command("DOMSnapshot.captureSnapshot", {}, "foreign-session"))).toThrow("unowned");
    expect(() => policy.authorize(command("DOMSnapshot.captureSnapshot", {}, "unknown-session"))).toThrow("unowned");
    expect(() => policy.authorize(command("DOMSnapshot.captureSnapshot"))).toThrow("owned CDP session");
    clock += 60_000;
    expect(() => policy.authorize(command("DOMSnapshot.captureSnapshot", {}, "owned-session"))).toThrow("expired");
    clock = now;
    active = undefined;
    expect(() => policy.authorize(command("DOMSnapshot.captureSnapshot", {}, "owned-session"))).toThrow();
  });

  test.each(["Target.activateTarget", "Page.bringToFront", "Browser.setWindowBounds", "Browser.close", "Target.sendMessageToTarget", "Target.exposeDevToolsProtocol", "Target.attachToBrowserTarget", "Security.setIgnoreCertificateErrors", "Unreviewed.newMethod"])("never permits %s even with every foreground action", method => {
    expect(() => new FocusPolicy("fixture-browser", lease, () => now).authorize(command(method))).toThrow("FOCUS_BLOCKED");
  });

  test("does not attach, pause or close foreign targets or own popups implicitly", () => {
    const policy = new FocusPolicy("fixture-browser", lease, () => now);
    for (const message of [command("Target.attachToTarget", {targetId: "foreign", flatten: true}), command("Target.closeTarget", {targetId: "foreign"}), command("Target.setAutoAttach", {autoAttach: true}), command("Target.createTarget", {url: "https://example.test", background: true}), command("Target.createTarget", {url: "about:blank", background: false})]) {
      expect(() => policy.authorize(message)).toThrow("FOCUS_BLOCKED");
    }
    policy.observe({method: "Target.attachedToTarget", params: {sessionId: "popup", targetInfo: {targetId: "popup"}}});
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "popup"))).toThrow("unowned");
  });

  test("owns only a confirmed created target and never retries uncertain creation", () => {
    let active = lease();
    const policy = new FocusPolicy("fixture-browser", () => active, () => now + 2);
    policy.authorize(command("Target.createTarget", {url: "about:blank", background: true}));
    expect(policy.createdTargets.size).toBe(0);
    policy.observe({id: 1, result: {targetId: "created"}});
    policy.authorize(command("Target.attachToTarget", {targetId: "created", flatten: true}));
    policy.observe({id: 1, result: {sessionId: "created-session"}});
    policy.authorize(command("Runtime.evaluate", {}, "created-session"));
    policy.observe({id: 1, result: {}});
    active = lease({issuedAt: now + 1});
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "created-session"))).toThrow("unowned");
  });

  test("same gateway blocks direct-CDP helper bypasses and expired reconnects", () => {
    let active: unknown = lease(), clock = now;
    const sent: string[] = [], replies: any[] = [];
    const gateway = new FocusGateway("fixture-browser", () => active, text => sent.push(text), () => clock);
    const peer = {send: (text: string) => replies.push(JSON.parse(text)), close() {}};
    expect(gateway.connect(peer)).toBe(true);
    expect(gateway.connect({send() {}, close() {}})).toBe(false);
    gateway.receive(peer, JSON.stringify(command("Target.attachToTarget", {targetId: "owned", flatten: true})));
    gateway.fromBrowser(JSON.stringify({id: JSON.parse(sent[0]!).id, result: {sessionId: "session"}}));
    gateway.receive(peer, JSON.stringify({...command("Input.dispatchMouseEvent", {type: "mousePressed"}, "session"), id: 2}));
    expect(sent.length).toBe(2);
    clock += 60_000;
    gateway.receive(peer, JSON.stringify({...command("Input.dispatchMouseEvent", {type: "mouseReleased"}, "session"), id: 3}));
    expect(sent.length).toBe(2);
    expect(replies.at(-1).error.code).toBe(-32001);
    gateway.disconnect(peer);
    gateway.connect(peer);
    active = undefined;
    gateway.receive(peer, JSON.stringify(command("Page.captureScreenshot", {}, "session")));
    expect(sent.length).toBe(2);
    expect(replies.at(-1).error.code).toBe(-32001);
  });

  test("does not deliver stale replies to another helper after a disconnect", () => {
    const sent: any[] = [], first: any[] = [], second: any[] = [];
    const gateway = new FocusGateway("fixture-browser", lease, text => sent.push(JSON.parse(text)), () => now);
    const peer1 = {send: (text: string) => first.push(JSON.parse(text)), close() {}};
    const peer2 = {send: (text: string) => second.push(JSON.parse(text)), close() {}};
    gateway.connect(peer1);
    gateway.receive(peer1, JSON.stringify(command("Browser.getVersion")));
    gateway.disconnect(peer1);
    gateway.connect(peer2);
    gateway.receive(peer2, JSON.stringify(command("Browser.getVersion")));
    gateway.fromBrowser(JSON.stringify({id: sent[0].id, result: {}}));
    expect(second).toEqual([]);
    gateway.fromBrowser(JSON.stringify({id: sent[1].id, result: {}}));
    expect(second).toEqual([{id: 1, result: {}}]);
  });

  test("transport failures close the helper as uncertain without retrying a send", () => {
    let sends = 0, closes = 0;
    const replies: string[] = [];
    const gateway = new FocusGateway("fixture-browser", () => lease(), () => { sends++; throw new Error("synthetic pipe failure"); }, () => now);
    const peer = {send: (text: string) => replies.push(text), close: () => { closes++; }};
    gateway.connect(peer);
    gateway.receive(peer, JSON.stringify(command("Browser.getVersion")));
    expect(sends).toBe(1);
    expect(closes).toBe(1);
    expect(replies).toEqual([]);
    gateway.receive(peer, JSON.stringify(command("Browser.getVersion")));
    expect(sends).toBe(1);
  });

  test("pending requests are never replayed after a timeout/lease expiry", () => {
    let clock = now;
    const sends: string[] = [], replies: string[] = [];
    const gateway = new FocusGateway("fixture-browser", () => lease(), text => sends.push(text), () => clock);
    const peer = {send: (text: string) => replies.push(text), close() {}};
    gateway.connect(peer);
    gateway.receive(peer, JSON.stringify(command("Browser.getVersion")));
    clock += 60_000;
    gateway.receive(peer, JSON.stringify({...command("Browser.getVersion"), id: 2}));
    expect(sends).toHaveLength(1);
    expect(JSON.parse(replies[0]!).error.code).toBe(-32001);
    expect(replies.join("")).not.toContain("resumed");
  });

  test("launch plans require pipes and reject sandbox or GPU weakening", () => {
    expect(() => validateLaunch(["jailed-browser", "--remote-debugging-pipe"])).not.toThrow();
    for (const flags of [[], ["--remote-debugging-port=0"], ["--remote-debugging-pipe", "--remote-debugging-port=0"], ["--remote-debugging-pipe", "--no-sandbox"], ["--remote-debugging-pipe", "--disable-gpu"]]) {
      expect(() => validateLaunch(["browser", ...flags])).toThrow();
    }
  });
});
