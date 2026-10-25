import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {actions, type Lease} from "./policy.ts";
import {approveForeground, consumeLaunch, gatewayPath, leasePath, readPrivateJson, writePrivateJson} from "./lease.ts";
import {connectBrowser, newOwnedPage, ownedPage, writeState} from "../browser-config.js";

const temporary = mkdtempSync(join(tmpdir(), "browser-focus-transport-"));
const keys = ["BROWSER_TOOLS_FOCUS_RUNTIME_DIR", "BROWSER_TOOLS_RUNTIME_DIR", "BROWSER_TOOLS_STATE", "BROWSER_SESSION_GUARD_STATE"];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = join(temporary, "focus");
process.env.BROWSER_TOOLS_RUNTIME_DIR = join(temporary, "client");
process.env.BROWSER_TOOLS_STATE = join(temporary, "client/state.json");
process.env.BROWSER_SESSION_GUARD_STATE = join(temporary, "timer");
const grant = (extra: Partial<Lease> = {}): Lease => ({version: 1, browserId: "fixture-browser", issuedAt: Date.now() - 1, expiresAt: Date.now() + 60_000, launch: false, targets: ["owned"], actions: [...actions], ...extra});
let child: ReturnType<typeof Bun.spawn>;
let state: any;

beforeAll(async () => {
  writePrivateJson(leasePath(), grant({launch: true}));
  child = Bun.spawn([process.execPath, fileURLToPath(new URL("serve.ts", import.meta.url)), "--user-data-dir", join(temporary, "profile"), "--", process.execPath, fileURLToPath(new URL("fixtures/fake-browser.ts", import.meta.url)), "--remote-debugging-pipe"], {env: process.env, stdout: "pipe", stderr: "pipe"});
  const deadline = Date.now() + 5000;
  while (!existsSync(gatewayPath()) && Date.now() < deadline && child.exitCode === null) await Bun.sleep(10);
  if (!existsSync(gatewayPath())) throw new Error("Fake private-pipe gateway did not start");
  state = {...readPrivateJson(gatewayPath()), interactionMode: "foreground"};
  writeState(state);
});

afterAll(async () => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  if (child) await child.exited;
  rmSync(temporary, {recursive: true, force: true});
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe("guarded client and private-pipe integration without a desktop", () => {
  test("publishes a gateway identity, consumes launch consent and exposes no raw CDP HTTP verbs", async () => {
    expect(readPrivateJson(leasePath()).launch).toBe(false);
    const version = await (await fetch(`http://127.0.0.1:${state.port}/json/version`)).json() as any;
    expect(version.focusProtocol).toBe("browser-tools-focus-v2");
    expect(version.interactionMode).toBe("background");
    for (const path of ["/json/new", "/json/list", "/json/close/owned", "/json/version?escape=1"]) expect((await fetch(`http://127.0.0.1:${state.port}${path}`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${state.port}/json/version`, {headers: {origin: "https://example.test"}})).status).toBe(403);
  });

  test("launch tickets are single-use and the manual grant command requires an owner terminal", async () => {
    expect(() => consumeLaunch()).toThrow("launch lease");
    const before = readFileSync(leasePath(), "utf8");
    const issuer = Bun.spawn([process.execPath, fileURLToPath(new URL("lease.ts", import.meta.url)), "grant", "--launch", "--actions", "tab-create"], {env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
    expect(await issuer.exited).toBe(1);
    expect(await new Response(issuer.stderr).text()).toContain("interactive terminal");
    expect(readFileSync(leasePath(), "utf8")).toBe(before);
  });

  test("retains owned-target isolation across helper reconnects without auto-attachment", async () => {
    writePrivateJson(leasePath(), grant());
    let browser = await connectBrowser();
    const page = await newOwnedPage(browser);
    expect(await page.evaluate("fixture")).toEqual({fixture: true});
    expect((await page.screenshot()).toString()).toBe("fixture-image");
    await page.bringToFront();
    await page.keyboard.type("DISPOSABLE FIXTURE INPUT");
    await browser.disconnect();
    await Bun.sleep(10);
    browser = await connectBrowser();
    expect((await ownedPage(browser)).targetId).toBe(page.targetId);
    await expect(browser.page("foreign")).rejects.toThrow("FOCUS_BLOCKED");
    await browser.disconnect();
  });

  test("blocks revocation and expiry during an already attached direct-CDP helper", async () => {
    writePrivateJson(leasePath(), grant());
    await Bun.sleep(10);
    const browser = await connectBrowser();
    const page = await browser.page("owned");
    const cdp = await page.createCDPSession();
    await cdp.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 1, y: 1});
    rmSync(leasePath());
    await expect(cdp.send("Input.dispatchMouseEvent", {type: "mousePressed", x: 1, y: 1})).rejects.toThrow("FOCUS_BLOCKED");
    writePrivateJson(leasePath(), grant({expiresAt: Date.now() - 1}));
    await expect(cdp.send("Runtime.evaluate", {expression: "fixture"})).rejects.toThrow("FOCUS_BLOCKED");
    await browser.disconnect();
    await Bun.sleep(10);
    await expect(connectBrowser()).rejects.toThrow("FOCUS_BLOCKED");
  });

  test("a raw WebSocket helper cannot bypass foreground approval", async () => {
    rmSync(leasePath(), {force: true});
    await Bun.sleep(10);
    const socket = new WebSocket(state.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("Fixture socket failed")); });
    const response = new Promise<any>(resolve => socket.onmessage = event => resolve(JSON.parse(String(event.data))));
    socket.send(JSON.stringify({id: 1, method: "Input.dispatchMouseEvent", params: {type: "mousePressed", x: 1, y: 1}, sessionId: "session-1"}));
    expect((await response).error.code).toBe(-32001);
    socket.close();
  });

  test("checks the timer before each send, including a direct CDP session", async () => {
    writePrivateJson(leasePath(), grant());
    await Bun.sleep(10);
    const browser = await connectBrowser();
    const page = await browser.page("owned");
    writeFileSync(process.env.BROWSER_SESSION_GUARD_STATE!, `${Date.now() - 120_000}\t1`);
    await expect(page.mouse.click(1, 1)).rejects.toThrow("EXPIRED");
    await expect(page.evaluate("fixture")).rejects.toThrow("EXPIRED");
    await browser.disconnect();
    rmSync(process.env.BROWSER_SESSION_GUARD_STATE!);
  });

  test("Node CLI helpers use the same guarded transport", async () => {
    writePrivateJson(leasePath(), grant());
    const browser = await connectBrowser();
    await newOwnedPage(browser);
    await browser.disconnect();
    const helper = Bun.spawn(["node", fileURLToPath(new URL("../browser-eval.js", import.meta.url)), "({fixture:true})"], {env: process.env, stdout: "pipe", stderr: "pipe"});
    const [output, error, code] = await Promise.all([new Response(helper.stdout).text(), new Response(helper.stderr).text(), helper.exited]);
    expect(code).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("fixture: true");
  });

  test("passive default works without approval and never upgrades because another lease exists", async () => {
    writePrivateJson(leasePath(), grant());
    let browser = await connectBrowser();
    await newOwnedPage(browser);
    await browser.disconnect();
    rmSync(leasePath());
    writeState({...state, interactionMode: "background"});
    try {
      browser = await connectBrowser();
      const page = await ownedPage(browser), cdp = await page.createCDPSession();
      expect((await cdp.send("DOM.getDocument", {depth: 0})).root.nodeId).toBe(1);
      await expect(page.bringToFront()).rejects.toThrow("FOCUS_BLOCKED");
      await cdp.detach(); await browser.disconnect();
      const helper = Bun.spawn(["node", fileURLToPath(new URL("../browser-inspect.js", import.meta.url)), "input"], {env: process.env, stdout: "pipe", stderr: "pipe"});
      const [output, code] = await Promise.all([new Response(helper.stdout).text(), helper.exited]);
      expect(code).toBe(0); expect(JSON.parse(output).matches).toBe(1); expect(output).not.toContain("PRIVATE INPUT");
      writePrivateJson(leasePath(), grant({actions: [...actions]}));
      browser = await connectBrowser();
      await expect((await ownedPage(browser)).evaluate("fixture")).rejects.toThrow("FOCUS_BLOCKED");
      await browser.disconnect();
    } finally { writeState(state); }
  });

  test("explicit direct endpoint works with ordinary Puppeteer attachment, then expires", async () => {
    const {default: puppeteer} = await import("puppeteer-core");
    writePrivateJson(leasePath(), grant({actions: ["direct-cdp"]}));
    const browser = await puppeteer.connect({browserWSEndpoint: `${state.webSocketDebuggerUrl}/direct`, defaultViewport: null, protocolTimeout: 3000});
    try {
      expect(await browser.version()).toBe("Chrome/134.0.0.0");
      expect((await browser.targets()).some(target => target.type() === "page")).toBe(true);
      const cdp = await browser.targets().find(target => target.type() === "page")!.createCDPSession();
      await cdp.send("Page.bringToFront");
      await cdp.send("Network.setCacheDisabled", {cacheDisabled: true});
      rmSync(leasePath());
      await expect(browser.version()).rejects.toThrow();
    } finally { await browser.disconnect(); }
    writePrivateJson(leasePath(), grant({actions: ["direct-cdp"]}));
    const discovered = await puppeteer.connect({browserURL: `http://127.0.0.1:${state.directPort}`, defaultViewport: null, protocolTimeout: 3000});
    try { expect(await discovered.version()).toBe("Chrome/134.0.0.0"); }
    finally { await discovered.disconnect(); }
    rmSync(leasePath());
    expect((await fetch(`http://127.0.0.1:${state.port}/direct/json/version`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${state.directPort}/json/version`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${state.directPort}/json/new`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${state.directPort}/json/version`, {headers: {Origin: "https://example.test"}})).status).toBe(403);
    writePrivateJson(leasePath(), grant({actions: ["inspect"]}));
    expect((await fetch(`http://127.0.0.1:${state.port}/direct/json/version`)).status).toBe(403);
  });

  test("broker approval requires explicit bounded confirmation and a separate direct mode", () => {
    const previousLease = readFileSync(leasePath(), "utf8");
    for (const request of [{}, {confirmed: true, mode: "background", seconds: 30, targets: []}, {confirmed: false, mode: "direct", seconds: 30, targets: []}, {confirmed: true, mode: "foreground", seconds: 301, targets: []}]) expect(() => approveForeground(request)).toThrow("FOCUS_BLOCKED");
    expect(readFileSync(leasePath(), "utf8")).toBe(previousLease);
    const scoped = approveForeground({confirmed: true, mode: "foreground", seconds: 30, targets: ["owned"]});
    expect(scoped.launch).toBe(false); expect(scoped.actions).not.toContain("direct-cdp"); expect(scoped.actions).toContain("activate");
    expect(approveForeground({confirmed: true, mode: "direct", seconds: 30, targets: []}).actions).toContain("direct-cdp");
  });

  test("explicit approval for a stopped gateway creates a single-use launch ticket without launching", () => {
    const previous = process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR, isolated = mkdtempSync(join(tmpdir(), "focus-launch-approval-"));
    process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = isolated;
    try {
      const approval = approveForeground({confirmed: true, mode: "foreground", seconds: 30, targets: []});
      expect(approval.launch).toBe(true); expect(approval.browserId).toMatch(/^[A-Za-z0-9-]+$/);
      expect(() => readPrivateJson(gatewayPath())).toThrow();
      consumeLaunch();
      expect(() => consumeLaunch()).toThrow("launch lease");
    } finally { process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = previous; rmSync(isolated, {recursive: true, force: true}); }
  });

  test("a saved marker does not authorize an unverified or port-reused raw endpoint", async () => {
    let upgrades = 0;
    const raw = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
      if (request.headers.has("upgrade")) upgrades++;
      return Response.json({Browser: "Chrome/fixture", webSocketDebuggerUrl: "ws://127.0.0.1/legacy"});
    }});
    try {
      writeState({...state, port: raw.port, webSocketDebuggerUrl: `ws://127.0.0.1:${raw.port}/devtools/browser/${state.browserId}`});
      await expect(connectBrowser()).rejects.toThrow("unverified");
      expect(upgrades).toBe(0);
    } finally { raw.stop(true); writeState(state); }
  });

  test("rejects legacy endpoint fallbacks without calling Puppeteer", async () => {
    for (const legacy of [{port: state.port, userDataDir: "fixture"}, {...state, focusProtocol: undefined}, {...state, webSocketDebuggerUrl: "ws://example.test/devtools/browser/escape"}]) {
      writeState(legacy);
      await expect(connectBrowser({connect() { throw new Error("must never be called"); }})).rejects.toThrow("FOCUS_BLOCKED");
    }
    writeState(state);
  });

  test("rejects shared, symlinked and oversized approval files", () => {
    const file = join(temporary, "unsafe.json"), link = join(temporary, "link.json");
    writeFileSync(file, "{}", {mode: 0o644});
    expect(() => readPrivateJson(file)).toThrow();
    chmodSync(file, 0o600);
    symlinkSync(file, link);
    expect(() => readPrivateJson(link)).toThrow();
    writeFileSync(file, " ".repeat(20_000));
    expect(() => readPrivateJson(file)).toThrow();
  });
});
