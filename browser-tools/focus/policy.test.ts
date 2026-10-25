import {describe, expect, test} from "bun:test";
import {actions, FocusPolicy, parseLease, type Command, type Lease} from "./policy.ts";
import {FocusGateway} from "./gateway.ts";
import {grantArguments} from "./lease.ts";
import {validateLaunch} from "./serve.ts";

const now = 100_000;
const lease = (extra: Partial<Lease> = {}): Lease => ({version: 1, browserId: "fixture-browser", issuedAt: now, expiresAt: now + 60_000, targets: ["owned"], actions: actions.filter(action => action !== "direct-cdp"), launch: false, ...extra});
const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Command => ({id: 1, method, params, ...(sessionId ? {sessionId} : {})});
function acknowledgedGateway(readLease: () => unknown, upstream: (text: string) => void, clock = () => now): FocusGateway {
  let root = 0;
  const gateway = new FocusGateway("fixture-browser", readLease, text => {
    const message = JSON.parse(text);
    if (!message.sessionId && ["Target.attachToBrowserTarget", "Target.detachFromTarget"].includes(message.method)) {
      gateway.fromBrowser(JSON.stringify({id: message.id, result: message.method === "Target.attachToBrowserTarget" ? {sessionId: `root-${++root}`} : {}}));
    } else upstream(text);
  }, clock);
  return gateway;
}
const unsafe = ["Page.navigate", "Page.reload", "Target.createTarget", "Runtime.evaluate", "Runtime.callFunctionOn", "Page.captureScreenshot", "DOMSnapshot.captureSnapshot", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Target.activateTarget", "Page.bringToFront", "Target.setAutoAttach"];

describe("passive default and explicit foreground/direct CDP", () => {
  test.each(unsafe)("blocks background %s even with an active broad approval", method => {
    const policy = new FocusPolicy("fixture-browser", () => lease({actions: [...actions]}), () => now);
    policy.sessions.set("session", "owned");
    policy.ownedTargets.add("owned");
    expect(() => policy.authorize(command(method, {}, "session"))).toThrow("passive");
  });
  test("metadata and structural owned-page reads need no lease, JavaScript or activation", () => {
    const policy = new FocusPolicy("fixture-browser", () => { throw new Error("No approval"); }, () => now, "background", new Set(["owned"]));
    for (const request of [command("Browser.getVersion"), command("Target.getTargets"), command("Target.attachToTarget", {targetId: "owned", flatten: true})]) {
      policy.authorize(request);
      policy.observe({id: 1, result: request.method === "Target.attachToTarget" ? {sessionId: "session"} : {}});
    }
    for (const method of ["Page.enable", "Page.getFrameTree", "DOM.getDocument", "DOM.querySelectorAll", "DOM.describeNode", "DOM.getAttributes"]) {
      policy.authorize(command(method, {}, "session")); policy.observe({id: 1, result: {}});
    }
    for (const request of [command("DOM.getDocument"), command("Target.attachToTarget", {targetId: "foreign", flatten: true}), command("DOM.getDocument", {}, "foreign"), command("Target.getTargetInfo")]) expect(() => policy.authorize(request)).toThrow("FOCUS_BLOCKED");
  });
  test("rejects expired, future, malformed, excessive and wrong-browser leases", () => {
    for (const value of [undefined, {}, lease({browserId: "other"}), lease({expiresAt: now}), lease({issuedAt: now + 1}), lease({expiresAt: now + 300_001}), lease({actions: ["unknown"] as any}), lease({targets: ["*"]})]) expect(() => parseLease(value, "fixture-browser", now)).toThrow("FOCUS_BLOCKED");
    expect(parseLease(lease(), "fixture-browser", now)).toEqual(lease());
    expect(() => grantArguments(["--target", "owned", "--actions", "inspect", "--seconds", "301"], "fixture-browser", now)).toThrow();
    expect(() => grantArguments(["--actions", "inspect"], "fixture-browser", now)).toThrow();
    expect(grantArguments(["--launch", "--actions", "tab-create", "--seconds", "30"], "fixture-browser", now).launch).toBe(true);
  });
  test("foreground restores activation, navigation and input only for owned targets and permitted actions", () => {
    let active: unknown = lease(), clock = now;
    const policy = new FocusPolicy("fixture-browser", () => active, () => clock, "foreground");
    policy.sessions.set("session", "owned");
    for (const request of [command("Target.activateTarget", {targetId: "owned"}), command("Page.bringToFront", {}, "session"), command("Page.navigate", {url: "https://example.test"}, "session"), command("Input.dispatchMouseEvent", {}, "session"), command("Input.insertText", {}, "session")]) {
      policy.authorize(request); policy.observe({id: 1, result: {}});
    }
    active = lease({actions: ["inspect"]});
    expect(() => policy.authorize(command("Page.bringToFront", {}, "session"))).toThrow("approval changed");
    const narrow = new FocusPolicy("fixture-browser", () => active, () => clock, "foreground");
    narrow.sessions.set("session", "owned");
    expect(() => narrow.authorize(command("Page.bringToFront", {}, "session"))).toThrow("activate");
    expect(() => policy.authorize(command("Target.activateTarget", {targetId: "foreign"}))).toThrow();
    clock += 60_000;
    expect(() => policy.authorize(command("Browser.getVersion"))).toThrow("expired");
    active = undefined;
    expect(() => policy.authorize(command("Browser.getVersion"))).toThrow();
  });
  test("direct mode restores broader CDP and auto-attachment, but must be separately approved", () => {
    let active: unknown = lease();
    const policy = new FocusPolicy("fixture-browser", () => active, () => now, "direct");
    expect(() => policy.authorize(command("Target.setAutoAttach", {autoAttach: true}))).toThrow("separate browser-wide");
    active = lease({actions: ["direct-cdp"]});
    for (const request of [command("Target.setAutoAttach", {autoAttach: true, flatten: true}), command("Target.attachToBrowserTarget"), command("Network.getCookies", {}, "direct-session"), command("Page.bringToFront", {}, "direct-session"), command("Browser.getWindowForTarget", {targetId: "foreign"})]) {
      policy.authorize(request); policy.observe({id: 1, result: {}});
    }
    policy.observe({method: "Target.attachedToTarget", params: {sessionId: "popup-session", targetInfo: {targetId: "popup"}}});
    expect(policy.sessions.get("popup-session")).toBe("popup");
    expect(policy.ownedTargets.has("popup")).toBe(false);
    active = undefined;
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "popup-session"))).toThrow();
  });
  test("nested protocol escapes and certificate bypasses remain blocked in direct mode", () => {
    for (const method of ["Target.sendMessageToTarget", "Target.exposeDevToolsProtocol", "Security.setIgnoreCertificateErrors"]) expect(() => new FocusPolicy("fixture-browser", () => lease({actions: ["direct-cdp"]}), () => now, "direct").authorize(command(method))).toThrow("forbidden");
  });
  test("scoped mode never pauses foreign pages or adopts popups", () => {
    const policy = new FocusPolicy("fixture-browser", lease, () => now, "foreground");
    for (const request of [command("Target.attachToTarget", {targetId: "foreign", flatten: true}), command("Target.closeTarget", {targetId: "foreign"}), command("Target.setAutoAttach", {autoAttach: true}), command("Target.createTarget", {url: "https://example.test", background: true}), command("Target.createTarget", {url: "about:blank", background: false}), command("Unreviewed.newMethod")]) expect(() => policy.authorize(request)).toThrow();
    policy.observe({method: "Target.attachedToTarget", params: {sessionId: "popup", targetInfo: {targetId: "popup"}}});
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "popup"))).toThrow("unowned");
  });
  test("confirmed creation registers passive ownership, not permanent foreground permission", () => {
    let active = lease();
    const policy = new FocusPolicy("fixture-browser", () => active, () => now + 2, "foreground");
    policy.authorize(command("Target.createTarget", {url: "about:blank", background: true}));
    expect(policy.ownedTargets.size).toBe(0);
    policy.observe({id: 1, result: {targetId: "created"}});
    policy.authorize(command("Target.attachToTarget", {targetId: "created", flatten: true}));
    policy.observe({id: 1, result: {sessionId: "created-session"}});
    expect(policy.ownedTargets.has("created")).toBe(true);
    active = lease({issuedAt: now + 1});
    expect(() => policy.authorize(command("Runtime.evaluate", {}, "created-session"))).toThrow("approval changed");
    expect(policy.createdTargets.size).toBe(0);
  });
  test("same-timestamp re-scoping and late create replies never inherit foreground permission", () => {
    let active = lease();
    const policy = new FocusPolicy("fixture-browser", () => active, () => now, "foreground");
    policy.authorize(command("Target.createTarget", {url: "about:blank", background: true}));
    active = lease({targets: ["different"]});
    policy.observe({id: 1, result: {targetId: "late"}});
    expect(policy.ownedTargets.has("late")).toBe(true);
    expect(() => policy.authorize(command("Target.attachToTarget", {targetId: "late", flatten: true}))).toThrow("approval changed");
    expect(policy.createdTargets.has("late")).toBe(false);
  });
  test("gateway reconnects retain passive ownership and filter unrelated metadata", () => {
    const sent: any[] = [], replies: any[] = [];
    const gateway = acknowledgedGateway(lease, text => sent.push(JSON.parse(text)));
    const peer = {send: (text: string) => replies.push(JSON.parse(text)), close() {}};
    gateway.connect(peer, "foreground");
    gateway.receive(peer, JSON.stringify(command("Target.createTarget", {url: "about:blank", background: true})));
    gateway.fromBrowser(JSON.stringify({id: sent.at(-1).id, result: {targetId: "created"}}));
    gateway.disconnect(peer); gateway.connect(peer);
    gateway.receive(peer, JSON.stringify(command("Target.getTargets")));
    gateway.fromBrowser(JSON.stringify({id: sent.at(-1).id, result: {targetInfos: [{targetId: "created"}, {targetId: "foreign"}]}}));
    expect(replies.at(-1).result.targetInfos).toEqual([{targetId: "created"}]);
    const before = sent.length;
    gateway.receive(peer, JSON.stringify(command("Runtime.evaluate")));
    expect(sent.length).toBe(before);
  });
  test("does not deliver stale replies to another helper after a disconnect", () => {
    const sent: any[] = [], first: any[] = [], second: any[] = [];
    const gateway = acknowledgedGateway(lease, text => sent.push(JSON.parse(text)));
    const peer1 = {send: (text: string) => first.push(JSON.parse(text)), close() {}}, peer2 = {send: (text: string) => second.push(JSON.parse(text)), close() {}};
    gateway.connect(peer1); gateway.receive(peer1, JSON.stringify(command("Browser.getVersion")));
    gateway.disconnect(peer1); gateway.connect(peer2); gateway.receive(peer2, JSON.stringify(command("Browser.getVersion")));
    gateway.fromBrowser(JSON.stringify({id: sent[0].id, result: {}})); expect(second).toEqual([]);
    gateway.fromBrowser(JSON.stringify({id: sent[1].id, result: {}})); expect(second).toEqual([{id: 1, result: {}}]);
  });
  test("expiry blocks direct sends, replies and events without replay or background downgrade", () => {
    let clock = now;
    const sent: string[] = [], replies: string[] = [];
    const gateway = acknowledgedGateway(() => lease({actions: ["direct-cdp"]}), text => sent.push(text), () => clock);
    const peer = {send: (text: string) => replies.push(text), close() {}};
    gateway.connect(peer, "direct"); gateway.receive(peer, JSON.stringify(command("Runtime.evaluate")));
    clock += 60_000;
    gateway.fromBrowser(JSON.stringify({id: JSON.parse(sent[0]!).id, result: {}}));
    gateway.fromBrowser(JSON.stringify({method: "Runtime.bindingCalled", params: {}}));
    expect(replies).toEqual([]);
    gateway.receive(peer, JSON.stringify({...command("Browser.getVersion"), id: 2}));
    expect(sent).toHaveLength(1); expect(JSON.parse(replies[0]!).error.code).toBe(-32001);
  });
  test.each(["null", "true", "0", "[]", '"text"', "{}", '{"id":null}', '{"id":1.5}', '{"id":1}', '{"id":1,"result":null}', '{"method":"event","params":null}', '{"method":null}', '{"method":"event","sessionId":1}', '{"method":"Target.attachedToTarget"}', '{"method":"Target.attachedToTarget","params":{}}', "{"])("malformed browser frame %s closes the peer without throwing or replaying", text => {
    let sends = 0, closes = 0, replies = 0;
    const gateway = acknowledgedGateway(() => lease({actions: ["direct-cdp"]}), () => { sends++; });
    const peer = {send() { replies++; }, close() { closes++; }};
    gateway.connect(peer, "direct");
    expect(() => gateway.fromBrowser(text)).not.toThrow();
    expect(closes).toBe(1); expect(replies).toBe(0);
    gateway.receive(peer, JSON.stringify(command("Browser.getVersion")));
    expect(sends).toBe(0);
  });
  test("pipe errors close the helper as uncertain without retrying", () => {
    let sends = 0, closes = 0;
    const gateway = acknowledgedGateway(lease, () => { sends++; throw new Error(); });
    const peer = {send() {}, close: () => { closes++; }};
    gateway.connect(peer); gateway.receive(peer, JSON.stringify(command("Browser.getVersion")));
    expect(sends).toBe(1); expect(closes).toBe(1);
    gateway.receive(peer, JSON.stringify(command("Browser.getVersion"))); expect(sends).toBe(1);
  });
  test("launch plans require private pipes without weakening sandboxing or GPU", () => {
    expect(() => validateLaunch(["jailed-browser", "--remote-debugging-pipe"])).not.toThrow();
    for (const flags of [[], ["--remote-debugging-port=0"], ["--remote-debugging-pipe", "--remote-debugging-port=0"], ["--remote-debugging-pipe", "--no-sandbox"], ["--remote-debugging-pipe", "--disable-gpu"]]) expect(() => validateLaunch(["browser", ...flags])).toThrow();
  });
});
