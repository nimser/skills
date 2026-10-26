import {closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import puppeteer from "puppeteer-core";
import {connectGuardedBrowser} from "./client.js";
import {approveForeground, leasePath, readPrivateJson} from "./lease.ts";
import {FocusTrace, fixtureHtml} from "./measurement.ts";

export async function foregroundRegression(): Promise<void> {
  if (process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED !== "1") throw new Error("Explicit approval for a dedicated live fixture regression window is required");
  if (process.platform !== "linux" || existsSync("/.dockerenv")) throw new Error("Use the approved graphical host with its supported jailed runtime");
  const home = homedir(), config = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const parent = join(home, ".local/state");
  mkdirSync(parent, {recursive: true, mode: 0o700});
  const root = mkdtempSync(join(parent, "focus-fixture-"));
  const id = root.split("/").at(-1)!.toLowerCase(), decoyId = `${id}-decoy`;
  const fixtureConfig = join(root, "config"), fixtureCache = join(root, "cache");
  const focus = join(root, "focus"), runtime = join(root, "client");
  const previous = process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR;
  process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = focus;
  mkdirSync(fixtureConfig, {recursive: true, mode: 0o700});
  mkdirSync(runtime, {recursive: true, mode: 0o700});
  const manifest = JSON.parse(readFileSync(join(config, "brave-jails.json"), "utf8"));
  const extensions = Bun.JSONC.parse(readFileSync(join(config, "brave-extensions.jsonc"), "utf8")) as {profiles: Record<string, unknown>};
  for (const profile of [id, decoyId]) {
    manifest.profiles[profile] = {...manifest.profiles.automation, bootstrap: {name: "Focus Fixture", color: "#A8C7FA"}};
    extensions.profiles[profile] = structuredClone(extensions.profiles.automation);
  }
  writeFileSync(join(fixtureConfig, "brave-jails.json"), JSON.stringify(manifest), {mode: 0o600});
  writeFileSync(join(fixtureConfig, "brave-extensions.jsonc"), JSON.stringify(extensions), {mode: 0o600});
  if (existsSync(join(config, "chromium-flags.conf"))) writeFileSync(join(fixtureConfig, "chromium-flags.conf"), readFileSync(join(config, "chromium-flags.conf")), {mode: 0o600});
  const deadline = Date.now() + 240_000;
  const reports: any[] = [];
  const report = (value: any) => { reports.push(value); console.log(JSON.stringify(value)); };
  const trace = new FocusTrace();
  let streamFailed = false;
  const stream = spawn("niri", ["msg", "--json", "event-stream"], {stdio: ["ignore", "pipe", "pipe"]});
  const lines = createInterface({input: stream.stdout});
  lines.on("line", line => { try { trace.compositor(JSON.parse(line)); } catch { streamFailed = true; } });
  stream.on("error", () => { streamFailed = true; });
  stream.on("exit", () => { streamFailed = true; });
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request, server) {
    const url = new URL(request.url);
    if (request.headers.get("host") !== `127.0.0.1:${server.port}`) return new Response("Forbidden", {status: 403});
    if (url.pathname === "/event" && request.method === "POST") {
      const text = await request.text();
      if (text.length > 128 || request.headers.get("origin") !== `http://127.0.0.1:${server.port}`) return new Response("Forbidden", {status: 403});
      try { trace.fixture(JSON.parse(text)); return new Response("ok"); } catch { return new Response("Invalid", {status: 400}); }
    }
    if (request.method === "GET" && ["/editor", "/reference", "/decoy", "/login", "/popup"].includes(url.pathname)) return new Response(fixtureHtml(url.pathname.slice(1) as any), {headers: {"content-type": "text/html", "cache-control": "no-store"}});
    return new Response("Not found", {status: 404});
  }});
  const origin = `http://127.0.0.1:${server.port}`;
  const children: {profile: string; process: ReturnType<typeof Bun.spawn>}[] = [];
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  let decoyBrowser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  let shared: Awaited<ReturnType<typeof connectGuardedBrowser>> | undefined;
  let finished = false;
  const watchdog = setTimeout(() => { for (const child of children) if (child.process.exitCode === null) child.process.kill("SIGTERM"); }, 245_000);
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
  const seconds = () => { const remaining = Math.floor((deadline - Date.now()) / 1000); check(remaining > 0, "Dedicated test window expired"); return remaining; };
  const denied = async (operation: () => Promise<unknown>) => {
    try { await operation(); } catch (error) { check(/FOCUS_BLOCKED|closed|disconnect|approval|denied/i.test(String(error)), "Unexpected denial reason"); return; }
    throw new Error("Operation unexpectedly permitted");
  };
  const scenario = async (name: string, operation: () => Promise<unknown>) => {
    seconds();
    const before = trace.snapshot();
    try { await operation(); }
    catch (error) { report({scenario: name, status: "failed"}); throw error; }
    await Bun.sleep(150);
    check(trace.streamHealthy && !streamFailed, "Continuous compositor stream unavailable");
    report({scenario: name, status: "passed", desktopTransitions: trace.desktopTransitions - before.desktopTransitions,
      referenceTransitions: trace.referenceTransitions - before.referenceTransitions,
      fixtureInputs: trace.fixtureInputs - before.fixtureInputs, fixtureKeys: trace.fixtureKeys - before.fixtureKeys,
      decoyInputs: trace.decoyInputs - before.decoyInputs});
  };
  const windows = () => {
    const result = Bun.spawnSync(["niri", "msg", "--json", "windows"], {stdout: "pipe", stderr: "pipe"});
    check(result.exitCode === 0, "Compositor window inspection failed");
    return JSON.parse(result.stdout.toString()) as {id: number; app_id: string; is_focused: boolean}[];
  };
  const launch = async (profile: string, appId: string, directory: string) => {
    process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = directory;
    try {
      approveForeground({mode: "direct", confirmed: true, seconds: seconds(), targets: []});
      const logfile = join(root, `${profile}.log`), log = openSync(logfile, "ax", 0o600);
      let child: ReturnType<typeof Bun.spawn>;
      try {
        child = Bun.spawn([process.execPath, fileURLToPath(new URL("serve.ts", import.meta.url)), "--user-data-dir", join(fixtureConfig, "BraveJails", profile), "--",
          process.execPath, process.env.BROWSER_TOOLS_TEST_LAUNCHER || join(home, ".local/bin/brave-jailed.ts"), `--jail-profile=${profile}`, `--class=${appId}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "about:blank"],
        {env: {...process.env, XDG_CONFIG_HOME: fixtureConfig, XDG_CACHE_HOME: fixtureCache}, stdout: log, stderr: log});
      } finally { closeSync(log); }
      children.push({profile, process: child});
      const stateFile = join(directory, "gateway.json"), startupDeadline = Date.now() + 22_000;
      while (!existsSync(stateFile) && child.exitCode === null && Date.now() < startupDeadline) await Bun.sleep(50);
      check(existsSync(stateFile), `Jailed private-pipe startup failed; inspect ${logfile}`);
      const state = readPrivateJson(stateFile);
      check(state.userDataDir === join(fixtureConfig, "BraveJails", profile), "Fixture gateway identity mismatch");
      return state;
    } finally { process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = focus; }
  };
  try {
    check(!windows().some(window => window.app_id === "brave-automation" || window.app_id === "brave-focus-decoy"), "A conflicting browser window is present; fixture class would be ambiguous");
    const state = await launch(id, "brave-automation", focus);
    browser = await puppeteer.connect({browserWSEndpoint: `${state.webSocketDebuggerUrl}/direct`, protocolTimeout: 8000});
    report({scenario: "jailed-private-pipe-and-puppeteer-websocket", status: "passed", browserVersion: await browser.version()});
    const page = await browser.newPage();
    await scenario("direct-navigation-reload", async () => {
      await page.goto(`${origin}/editor`, {waitUntil: "domcontentloaded"});
      check(await page.$("#editor"), "Fixture editor missing");
      await page.reload({waitUntil: "domcontentloaded"});
    });
    await scenario("direct-evaluation-click-typing-autosave", async () => {
      await page.bringToFront();
      await page.click("#focus");
      await page.keyboard.type("DISPOSABLE REGRESSION INPUT");
      check(await page.evaluate(() => localStorage.getItem("disposable-focus-autosave")) === "DISPOSABLE REGRESSION INPUT", "Disposable autosave did not persist");
    });
    await scenario("direct-dom-picker-change", async () => {
      await page.select("#picker", "second");
      check(await page.$eval("#picker", node => (node as HTMLSelectElement).value) === "second", "Picker did not change");
    });
    await scenario("direct-screenshot", async () => { const image = await page.screenshot(); check(image.length > 100, "Empty screenshot"); });
    const editorId = await page.createCDPSession();
    const {targetInfo: {targetId}} = await editorId.send("Target.getTargetInfo");
    await editorId.detach();
    await scenario("direct-target-tab-activation", async () => {
      const reference = await browser!.newPage();
      await reference.goto(`${origin}/reference`);
      await reference.bringToFront();
      await page.bringToFront();
      check(await page.evaluate(() => document.visibilityState === "visible"), "Explicit activation did not select the editor tab");
      await reference.close();
    });
    await scenario("direct-login-wall", async () => {
      const login = await browser!.newPage();
      await login.goto(`${origin}/login`);
      check(await login.$('input[type="password"]'), "Fixture login wall missing");
      await login.close();
    });
    await scenario("direct-popup-autoattachment", async () => {
      const popup = new Promise<any>(resolve => page.once("popup", resolve));
      await page.evaluate(() => { window.open("/popup", "_blank"); });
      const opened = await Promise.race([popup, Bun.sleep(5000).then(() => { throw new Error("Popup attachment timed out"); })]);
      check(opened.url().endsWith("/popup"), "Popup identity mismatch");
      await opened.close();
    });
    await scenario("direct-browser-global-gpu-metadata", async () => {
      const cdp = await browser!.target().createCDPSession();
      try {
        const info = await cdp.send("SystemInfo.getInfo");
        check(info.gpu.devices.length > 0 && info.gpu.featureStatus?.gpu_compositing === "enabled", "Hardware GPU compositing unavailable");
        report({scenario: "gpu-runtime", devices: info.gpu.devices.length, gpuCompositing: info.gpu.featureStatus?.gpu_compositing});
      } finally { await cdp.detach(); }
    });
    await scenario("native-browser-sandbox", async () => {
      const diagnostics = await browser!.newPage();
      try {
        await diagnostics.goto("chrome://sandbox");
        const text = await diagnostics.evaluate(() => document.body.innerText);
        const evidence = {pidNamespaces: /PID namespaces\s+Yes/i.test(text), networkNamespaces: /Network namespaces\s+Yes/i.test(text),
          seccompSandbox: /Seccomp-BPF sandbox\s+Yes/i.test(text), adequatelySandboxed: /adequately sandboxed/i.test(text)};
        report({scenario: "sandbox-runtime", ...evidence});
        check(evidence.pidNamespaces && evidence.networkNamespaces && evidence.seccompSandbox && evidence.adequatelySandboxed, "Native sandbox acceptance failed");
      } finally { await diagnostics.close(); }
    });
    await browser.disconnect(); browser = undefined;
    await Bun.sleep(100);
    browser = await puppeteer.connect({browserURL: `http://127.0.0.1:${state.directPort}`, protocolTimeout: 8000});
    check((await browser.version()).includes("/"), "Puppeteer HTTP discovery failed");
    report({scenario: "puppeteer-browserURL-reconnect", status: "passed"});
    await scenario("direct-live-revocation", async () => {
      rmSync(leasePath());
      await denied(() => browser!.version());
      check((await fetch(`http://127.0.0.1:${state.directPort}/json/version`)).status === 403, "Direct discovery remained authorized after revocation");
    });
    await browser.disconnect(); browser = undefined;
    const decoyState = await launch(decoyId, "brave-focus-decoy", join(root, "decoy-focus"));
    await scenario("jailed-decoy-puppeteer-attachment", async () => {
      decoyBrowser = await puppeteer.connect({browserWSEndpoint: `${decoyState.webSocketDebuggerUrl}/direct`, defaultViewport: null, protocolTimeout: 8000});
    });
    const decoy = await decoyBrowser!.newPage();
    await scenario("separate-decoy-navigation-and-dom-focus", async () => {
      await decoy.goto(`${origin}/decoy`, {waitUntil: "domcontentloaded", timeout: 8000});
      await decoy.bringToFront();
      await decoy.click("#decoy");
    });
    const decoyWindow = windows().filter(window => window.app_id === "brave-focus-decoy");
    check(decoyWindow.length === 1, "Separate decoy window missing or ambiguous");
    await scenario("explicit-fixture-compositor-focus-and-decoy-input", async () => {
      const result = Bun.spawnSync(["niri", "msg", "action", "focus-window", "--id", String(decoyWindow[0]!.id)], {stdout: "pipe", stderr: "pipe"});
      check(result.exitCode === 0 && windows().some(window => window.id === decoyWindow[0]!.id && window.is_focused), "Explicit fixture focus failed");
      const before = trace.decoyInputs;
      await decoy.keyboard.type("DISPOSABLE DECOY INPUT");
      await Bun.sleep(100);
      check(trace.decoyInputs > before, "Decoy structural input instrumentation unavailable");
    });
    approveForeground({mode: "foreground", confirmed: true, seconds: seconds(), targets: [targetId]});
    shared = await connectGuardedBrowser({...state, interactionMode: "foreground"}, runtime);
    const owned = await shared.page(targetId);
    await scenario("scoped-navigation-reload-evaluation", async () => {
      await owned.goto(`${origin}/editor`, {waitUntil: "domcontentloaded", timeout: 8000});
      await owned.reload({waitUntil: "domcontentloaded", timeout: 8000});
      check(await owned.evaluate(() => document.querySelectorAll("textarea").length) === 1, "Scoped evaluation failed");
    });
    await scenario("scoped-activation-pointer-keyboard-screenshot", async () => {
      await owned.bringToFront();
      const point = await owned.evaluate(() => { const box = document.querySelector("#editor")!.getBoundingClientRect(); return {x: box.x + 5, y: box.y + 5}; });
      await owned.mouse.click(point.x, point.y);
      await owned.keyboard.type("SCOPED FIXTURE INPUT");
      check(await owned.evaluate(() => localStorage.getItem("disposable-focus-autosave")) === "SCOPED FIXTURE INPUT", "Scoped typing/autosave failed");
      check((await owned.screenshot()).length > 100, "Scoped screenshot failed");
    });
    let created: Awaited<ReturnType<NonNullable<typeof shared>["newOwnedPage"]>>;
    await scenario("scoped-blank-tab-create", async () => { created = await shared!.newOwnedPage(); });
    await scenario("scoped-created-tab-navigation", async () => { await created.page.goto(`${origin}/reference`, {waitUntil: "domcontentloaded", timeout: 8000}); });
    await scenario("scoped-created-tab-close", async () => { await created.page.close(); });
    await scenario("scoped-foreign-autoattach-unreviewed-method-denial", async () => {
      await denied(() => shared!.page("unowned-fixture-target"));
      const cdp = await shared!.createCDPSession();
      await denied(() => cdp.send("Target.setAutoAttach", {autoAttach: true, flatten: true, waitForDebuggerOnStart: true}));
      await denied(() => cdp.send("Unreviewed.newMethod"));
    });
    await shared.disconnect(); shared = undefined;
    shared = await connectGuardedBrowser({...state, interactionMode: "background"}, runtime);
    await scenario("passive-with-active-approval-never-upgrades", async () => {
      const page = await shared!.page(targetId);
      await denied(() => page.evaluate("document.title"));
      await denied(() => page.bringToFront());
    });
    rmSync(leasePath());
    await scenario("passive-reads-without-lease-do-not-take-decoy-focus", async () => {
      const before = trace.snapshot();
      const cdp = await (await shared!.page(targetId)).createCDPSession();
      try {
        const {root} = await cdp.send("DOM.getDocument", {depth: 0});
        check((await cdp.send("DOM.querySelectorAll", {nodeId: root.nodeId, selector: "textarea"})).nodeIds.length === 1, "Passive structural read failed");
        await Bun.sleep(150);
        check(trace.desktopTransitions === before.desktopTransitions && trace.fixtureKeys === before.fixtureKeys && trace.fixtureInputs === before.fixtureInputs, "Passive reads disturbed fixture focus or input");
        check(windows().some(window => window.id === decoyWindow[0]!.id && window.is_focused), "Passive reads took decoy window focus");
      } finally { await cdp.detach(); }
    });
    await scenario("passive-evaluation-input-activation-navigation-denial", async () => {
      const page = await shared!.page(targetId);
      await denied(() => page.evaluate("document.title"));
      await denied(() => page.bringToFront());
      await denied(() => page.keyboard.type("MUST NOT BE SENT"));
      await denied(() => page.goto(`${origin}/reference`));
      await denied(() => page.screenshot());
    });
    await shared.disconnect(); shared = undefined;
    check(seconds() >= 3, "Insufficient approved time for the expiry experiment");
    approveForeground({mode: "foreground", confirmed: true, seconds: 2, targets: [targetId]});
    shared = await connectGuardedBrowser({...state, interactionMode: "foreground"}, runtime);
    const expiring = await shared.page(targetId);
    await scenario("live-expiry-stops-attached-session-and-discovery", async () => {
      check(await expiring.evaluate(() => document.querySelectorAll("textarea").length) === 1, "Pre-expiry scope unavailable");
      await Bun.sleep(2100);
      await denied(() => expiring.keyboard.type("MUST NOT BE SENT"));
      check((await fetch(`http://127.0.0.1:${state.port}/foreground/json/version`)).status === 403, "Foreground discovery remained authorized after expiry");
    });
    await shared.disconnect(); shared = undefined;
    finished = true;
    report({status: "passed", scenarios: reports.filter(item => item.status === "passed").length, continuousCompositorEvidence: trace.streamHealthy && !streamFailed,
      physicalTypingRedirectionMeasured: false, backgroundCapabilitiesApproved: 0});
  } finally {
    clearTimeout(watchdog);
    await shared?.disconnect().catch(() => {});
    await browser?.disconnect().catch(() => {});
    await decoyBrowser?.disconnect().catch(() => {});
    for (const child of children) {
      if (child.process.exitCode === null) child.process.kill("SIGTERM");
      await Promise.race([child.process.exited, Bun.sleep(6000).then(() => { if (child.process.exitCode === null) child.process.kill("SIGKILL"); })]);
      Bun.spawnSync(["/usr/bin/firejail", `--shutdown=brave-${child.profile}`], {stdout: "pipe", stderr: "pipe"});
    }
    rmSync(join(focus, "foreground.json"), {force: true});
    rmSync(join(root, "decoy-focus/foreground.json"), {force: true});
    lines.close(); stream.kill("SIGTERM"); server.stop(true);
    if (previous === undefined) delete process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR;
    else process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR = previous;
    const stopped = children.every(child => child.process.exitCode !== null);
    // Failed runs keep their profiles and logs for inspection.
    if (finished && stopped) rmSync(root, {recursive: true, force: true});
    report({cleanup: "fixture processes stopped", completed: finished, runtime: finished && stopped ? "removed" : root});
  }
}

if (import.meta.main) await foregroundRegression();
