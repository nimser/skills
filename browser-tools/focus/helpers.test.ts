import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {detectLoginWall} from "../login-wait.js";
import {requestHostResume} from "./host.js";
import {FOCUS_PROTOCOL} from "./client.js";
import {modeEndpoint, startOptions} from "./mode.js";
import {foregroundRegression} from "./regression.ts";

const status = {focusProtocol: FOCUS_PROTOCOL, defaultMode: "background", backgroundPolicy: "passive-dom-v1", foregroundLeases: true, directCdp: true,
  networkSelection: "generation-v1", defaultNetworkMode: "proxy", networkModes: ["proxy", "direct"], windowConfirmation: "desktop-v1"};
const sessionId = "00000000-0000-0000-0000-000000000001";
const state = {mode: "host", networkMode: "proxy", focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", port: 1234, directPort: 1235,
  webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/fixture", userDataDir: "/fixture/profile"};
const approved = () => ({sessionId, token: "a".repeat(64), expiresAt: Date.now() + 29_000});
const options = {mode: "foreground", seconds: 30, targets: ["owned"], pinnedBrowserId: "fixture", sessionId};

test("live foreground regression requires separate desktop approval before creating fixtures", async () => {
  const previous = process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
  delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
  try { await expect(foregroundRegression()).rejects.toThrow("dedicated live fixture regression window"); }
  finally {
    if (previous === undefined) delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
    else process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED = previous;
  }
});

test("login detection propagates denied or uncertain evaluation", async () => {
  const page = {url: () => "https://example.test", evaluate: async () => { throw new Error("FOCUS_BLOCKED: fixture denial"); }};
  await expect(detectLoginWall(page)).rejects.toThrow("FOCUS_BLOCKED");
  await expect(detectLoginWall({url: () => "https://example.test", evaluate: async () => ({passwords: 0, otp: 0, buttons: [], title: "Fixture", text: ""})})).resolves.toBeUndefined();
});

test("legacy launchers fail before resume or foreground approval", async () => {
  for (const [response, plan] of [[new Response("Not found", {status: 404}), undefined], [Response.json({}), undefined],
    [Response.json({...status, networkSelection: undefined}), undefined], [Response.json({...status, windowConfirmation: undefined}), options]] as const) {
    const requests: string[] = [];
    await expect(requestHostResume(async url => { requests.push(url); return response; }, plan)).rejects.toThrow("no launch was requested");
    expect(requests).toEqual(["http://127.0.0.1:19222/status"]);
  }
});

test("broker denials surface their bounded reason, not arbitrary bodies", async () => {
  const denial = (body: unknown) => async (url: string) => url.endsWith("/status") ? Response.json(status) : Response.json(body, {status: 409});
  await expect(requestHostResume(denial({error: "FOCUS_BLOCKED: automation browser exited during startup; inspect logs"}), options))
    .rejects.toThrow("FOCUS_BLOCKED: automation browser exited during startup; inspect logs");
  for (const body of [{error: "stack trace\nsecret"}, {error: "internal detail"}, {error: `FOCUS_BLOCKED: ${"x".repeat(600)}`}, "text"]) {
    await expect(requestHostResume(denial(body), options)).rejects.toThrow("FOCUS_BLOCKED: foreground approval/startup failed; inspect before retrying");
  }
});

test("only explicit foreground requests a window, with its own duration and network", () => {
  expect(startOptions([])).toEqual({mode: "background", seconds: 900, networkMode: "proxy"});
  expect(startOptions(["--host", "--resume"])).toEqual(startOptions([]));
  expect(startOptions(["--foreground", "--seconds", "5400"])).toEqual({mode: "foreground", seconds: 5400, networkMode: "proxy"});
  expect(startOptions(["--foreground", "--direct-cdp"])).toEqual({mode: "direct", seconds: 900, networkMode: "proxy"});
  expect(startOptions(["--network=direct"])).toEqual({mode: "background", seconds: 900, networkMode: "direct"});
  expect(startOptions(["--foreground", "--network=direct"])).toEqual({mode: "foreground", seconds: 900, networkMode: "direct"});
  for (const args of [["--direct-cdp"], ["--seconds", "30"], ["--foreground", "--seconds", "0"], ["--foreground", "--seconds", "1e3"],
    ["--foreground", "--exception", "receipt"], ["--foreground", "--foreground"], ["--keep-cookies"], ["--network=automatic"],
    ["--network=proxy", "--network=direct"], ["--network", "direct"], ["--unknown"]]) expect(() => startOptions(args)).toThrow();
  expect(modeEndpoint(state).browserWSEndpoint).toBe(state.webSocketDebuggerUrl);
});

test("network selection is independent of interaction mode, with no caller-supplied confirmation", async () => {
  for (const mode of ["background", "foreground", "direct"]) for (const networkMode of ["proxy", "direct"]) {
    const requests: {url: string; options: RequestInit}[] = [];
    const plan = {...options, mode, networkMode};
    const window = mode === "background" ? undefined : approved();
    const request = async (url: string, input: RequestInit) => {
      requests.push({url, options: input});
      return Response.json(url.endsWith("/status") ? status : {...state, networkMode, window});
    };
    const result = await requestHostResume(request, plan);
    expect(result).toEqual({...state, networkMode, interactionMode: mode, ...(window ? {window} : {})});
    expect(requests.map(({url}) => new URL(url).pathname)).toEqual(["/status", mode === "background" ? "/resume" : "/foreground"]);
    expect(JSON.parse(requests[1]!.options.body as string)).toEqual(mode === "background" ? {networkMode} : plan);
    for (const wrong of [undefined, networkMode === "proxy" ? "direct" : "proxy"]) {
      await expect(requestHostResume(async url => Response.json(url.endsWith("/status") ? status : {...state, networkMode: wrong, window}), plan))
        .rejects.toThrow("invalid host gateway identity");
    }
  }
});

test("foreground startup refuses unbound or oversized windows", async () => {
  for (const [window, message] of [[undefined, "expired, invalid"], [{...approved(), sessionId: "other"}, "another Pi session"],
    [{...approved(), expiresAt: Date.now() + 60_000}, "longer window"]] as const) {
    await expect(requestHostResume(async url => Response.json(url.endsWith("/status") ? status : {...state, window}), options)).rejects.toThrow(message);
  }
});

test("all bundled browser helpers use the guarded client, not independent browser drivers", () => {
  const directory = new URL("../", import.meta.url);
  for (const name of readdirSync(directory).filter(name => /^browser-.*\.js$/.test(name) && !name.endsWith(".test.js"))) {
    const source = readFileSync(new URL(name, directory), "utf8");
    expect(source).not.toMatch(/import\s+.*(?:puppeteer|playwright)|puppeteer\.connect|new\s+WebSocket/);
  }
  expect(readFileSync(new URL("browser-config.js", directory), "utf8")).toContain("connectGuardedBrowser");
  expect(readFileSync(new URL("mappings/cli.ts", directory), "utf8")).not.toContain("puppeteer.connect");
});
