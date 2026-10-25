import {basename} from "node:path";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {connectBrowser, writeState} from "../browser-config.js";
import {detectLoginWall} from "../login-wait.js";
import {gatewayPath, readPrivateJson} from "./lease.ts";
import {FocusTrace, fixtureHtml} from "./measurement.ts";

export async function desktopAcceptance(selected?: string): Promise<void> {
  if (process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED !== "1") throw new Error("Explicit owner approval for a dedicated desktop experiment is required");
  const state = readPrivateJson(gatewayPath());
  if (!basename(state.userDataDir || "").startsWith("focus-fixture-") || !process.env.BROWSER_TOOLS_RUNTIME_DIR) throw new Error("Use a disposable focus-fixture-* jailed profile and a separate explicit client runtime");
  writeState({...state, interactionMode: "foreground"});
  const trace = new FocusTrace();
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("host") !== `127.0.0.1:${server.port}`) return new Response("Forbidden", {status: 403});
    if (url.pathname === "/event" && request.method === "POST") {
      if (request.headers.get("content-type") !== "application/json" || request.headers.get("origin") !== `http://127.0.0.1:${server.port}`) return new Response("Forbidden", {status: 403});
      if (Number(request.headers.get("content-length") || 0) > 128) return new Response("Too large", {status: 413});
      try {
        const text = await request.text();
        if (text.length > 128) throw new Error();
        trace.fixture(JSON.parse(text));
        return new Response("ok");
      } catch { return new Response("Structural fixture events only", {status: 400}); }
    }
    const role = url.pathname.slice(1);
    if (request.method === "GET" && ["editor", "reference", "decoy", "login", "popup"].includes(role)) return new Response(fixtureHtml(role as any), {headers: {"Content-Type": "text/html", "Cache-Control": "no-store"}});
    return new Response("Not found", {status: 404});
  }});
  const origin = `http://127.0.0.1:${server.port}`;
  const stream = spawn("niri", ["msg", "--json", "event-stream"], {stdio: ["ignore", "pipe", "pipe"]});
  let streamError = false;
  const lines = createInterface({input: stream.stdout});
  lines.on("line", line => { try { trace.compositor(JSON.parse(line)); } catch { streamError = true; } });
  stream.on("error", () => { streamError = true; });
  stream.on("exit", () => { trace.streamHealthy = false; });
  let browser: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let expectedTargets = 0;
  async function discover() {
    const root = await browser!.createCDPSession();
    await root.send("Target.setDiscoverTargets", {discover: true});
    unsubscribe = browser!.onProtocolEvent((event: any) => {
      if (event.method === "Target.targetCreated" && event.params?.targetInfo?.type === "page") {
        if (expectedTargets > 0) expectedTargets--;
        else trace.unexpectedTargets++;
      }
    });
  }
  const wait = async (condition: () => boolean, milliseconds: number) => {
    const deadline = Date.now() + milliseconds;
    while (!condition() && Date.now() < deadline && !streamError) await Bun.sleep(25);
    if (!condition() || streamError) throw new Error("Fixture/compositor precondition unavailable; no fallback");
  };
  try {
    browser = await connectBrowser();
    const metadata = await (await browser.createCDPSession()).send("Browser.getVersion");
    const niriVersion = Bun.spawnSync(["niri", "--version"], {stdout: "pipe", stderr: "pipe"});
    console.log(JSON.stringify({platform: process.platform, arch: process.arch, bun: Bun.version, node: process.versions.node,
      browserVersion: String(metadata.product || "").match(/\d+(?:\.\d+)+/)?.[0] || "unknown",
      niriVersion: niriVersion.stdout.toString().match(/\d+(?:\.\d+)+/)?.[0] || "unknown"}));
    const reference = (await browser.newOwnedPage()).page;
    await reference.goto(`${origin}/reference`);
    let editor = (await browser.newOwnedPage()).page;
    await editor.goto(`${origin}/editor`);
    await discover();
    console.log(`Dedicated fixture only: manually select its reference tab, open ${origin}/decoy in a separate isolated browser/application, click Begin measurement and type disposable text there.`);
    await wait(() => trace.ready && trace.referenceVisible && !trace.editorVisible && trace.decoyInputs > 0 && trace.streamHealthy, 180_000);
    const snapshot = spawn("niri", ["msg", "--json", "windows"], {stdio: ["ignore", "pipe", "pipe"]});
    let windowsText = "";
    for await (const chunk of snapshot.stdout) windowsText += chunk;
    let windows;
    try { windows = JSON.parse(windowsText); } catch { throw new Error("Compositor snapshot unavailable; no fallback"); }
    if (!Array.isArray(windows)) throw new Error("Invalid compositor snapshot");
    const focused = windows.find((window: any) => window.is_focused);
    if (!focused || focused.app_id === "brave-automation") throw new Error("The decoy, not the automation browser, must hold desktop focus");
    const point = () => editor.evaluate(() => {
      const bounds = document.querySelector("#picker")!.getBoundingClientRect();
      return {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    });
    const scenarios: Record<string, () => Promise<unknown>> = {
      navigation: () => editor.goto(`${origin}/editor?navigation`),
      reload: () => editor.reload(),
      "background-tab-creation": async () => { expectedTargets++; await browser!.newOwnedPage(); },
      evaluation: () => editor.evaluate(() => ({formCount: document.forms.length, editorCount: document.querySelectorAll("textarea").length})),
      "dom-click": () => editor.evaluate(() => (document.querySelector("#focus") as HTMLButtonElement).click()),
      "coordinate-click": async () => { const {x, y} = await point(); await editor.mouse.click(x, y); },
      "direct-cdp-click": async () => {
        const {x, y} = await point();
        const cdp = await editor.createCDPSession();
        try {
          await cdp.send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", clickCount: 1});
          await cdp.send("Input.dispatchMouseEvent", {type: "mouseReleased", x, y, button: "left", clickCount: 1});
        } finally { await cdp.detach(); }
      },
      "function-picker": () => editor.evaluate(() => {
        const select = document.querySelector("#picker") as HTMLSelectElement;
        select.value = "second";
        select.dispatchEvent(new Event("change", {bubbles: true}));
      }),
      screenshot: async () => { await editor.screenshot(); },
      reconnect: async () => {
        unsubscribe?.();
        await browser!.disconnect();
        browser = await connectBrowser();
        editor = await browser.page(editor.targetId);
        await discover();
      },
      "login-wall": async () => { await (await browser!.page(editor.targetId)).goto(`${origin}/login`); if (!await detectLoginWall(await browser!.page(editor.targetId))) throw new Error("Fixture login wall was not detected"); },
      popup: async () => { await (await browser!.page(editor.targetId)).evaluate(() => { window.open("/popup", "_blank"); }); },
    };
    if (selected && !Object.hasOwn(scenarios, selected)) throw new Error("Unknown fixture scenario");
    for (const [name, action] of Object.entries(scenarios)) {
      if (selected && name !== selected) continue;
      const before = trace.snapshot();
      let status = "observed";
      try {
        await action();
      } catch { status = "unsupported-or-uncertain"; }
      await Bun.sleep(150);
      const after = trace.snapshot();
      if (status === "observed" && after.decoyInputs === before.decoyInputs) status = "inconclusive-no-typing-sample";
      if (status === "observed" && name === "popup" && after.unexpectedTargets - before.unexpectedTargets !== 1) status = "inconclusive-popup-creation";
      const report = {scenario: name, status,
        desktopTransitions: after.desktopTransitions - before.desktopTransitions,
        referenceTransitions: after.referenceTransitions - before.referenceTransitions,
        fixtureInputs: after.fixtureInputs - before.fixtureInputs,
        fixtureKeys: after.fixtureKeys - before.fixtureKeys,
        decoyInputs: after.decoyInputs - before.decoyInputs,
        unexpectedTargets: after.unexpectedTargets - before.unexpectedTargets,
        streamHealthy: trace.streamHealthy && !streamError,
        completeTypingSample: after.decoyInputs > before.decoyInputs};
      console.log(JSON.stringify(report));
      if (status !== "observed" || report.desktopTransitions || report.referenceTransitions || report.fixtureInputs || report.fixtureKeys || !report.streamHealthy || (name !== "popup" && report.unexpectedTargets)) throw new Error("Desktop scenario failed or is unsupported; stop without restoring focus or retrying");
    }
    console.log(JSON.stringify({backgroundCapabilitiesApproved: 0, fixtureInputCount: trace.fixtureInputs, fixtureKeyCount: trace.fixtureKeys, streamHealthy: trace.streamHealthy, ownerCleanupRequired: true}));
  } finally {
    unsubscribe?.();
    await browser?.disconnect().catch(() => {});
    lines.close();
    stream.kill("SIGTERM");
    server.stop(true);
  }
}

if (import.meta.main) await desktopAcceptance(process.argv[2]);
