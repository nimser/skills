import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {detectLoginWall} from "../login-wait.js";
import {requestHostResume} from "./host.js";
import {FOCUS_PROTOCOL} from "./client.js";
import {modeEndpoint, startOptions} from "./mode.js";
import {foregroundRegression} from "./regression.ts";

const status = {focusProtocol: FOCUS_PROTOCOL, defaultMode: "background", backgroundPolicy: "passive-dom-v1", foregroundLeases: true, directCdp: true};

test("live foreground regression requires separate desktop approval before creating fixtures", async () => {
  const previous = process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
  delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
  try { await expect(foregroundRegression()).rejects.toThrow("dedicated live fixture regression window"); }
  finally {
    if (previous === undefined) delete process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED;
    else process.env.BROWSER_TOOLS_DESKTOP_TEST_APPROVED = previous;
  }
});

test("login detection propagates denied/uncertain evaluation instead of bypassing policy", async () => {
  const page = {url: () => "https://example.test", evaluate: async () => { throw new Error("FOCUS_BLOCKED: fixture denial"); }};
  await expect(detectLoginWall(page)).rejects.toThrow("FOCUS_BLOCKED");
  await expect(detectLoginWall({url: () => "https://example.test", evaluate: async () => ({passwords: 0, otp: 0, buttons: [], title: "Fixture", text: ""})})).resolves.toBeUndefined();
});

test("legacy launchers cannot start a raw browser before focus preflight", async () => {
  for (const response of [new Response("Not found", {status: 404}), Response.json({}), Response.json({focusProtocol: FOCUS_PROTOCOL, foregroundLeases: true, backgroundActions: 1})]) {
    const requests: string[] = [];
    await expect(requestHostResume(async (url: string) => { requests.push(url); return response; })).rejects.toThrow("no launch was requested");
    expect(requests).toEqual(["http://127.0.0.1:19222/status"]);
  }
});

test("guarded host discovery requests resume only after static policy status", async () => {
  const requests: string[] = [];
  const state = {mode: "host", focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", port: 1234, directPort: 1235,
    webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/fixture", userDataDir: "/fixture/profile"};
  const result = await requestHostResume(async (url: string) => {
    requests.push(url);
    return Response.json(url.endsWith("/status") ? status : state);
  });
  expect(result).toEqual({...state, interactionMode: "background"});
  expect(requests).toEqual(["http://127.0.0.1:19222/status", "http://127.0.0.1:19222/resume"]);
});

test("modes and durations must be explicit; default never selects or renews elevated access", () => {
  expect(startOptions([])).toEqual({mode: "background", seconds: 60});
  expect(startOptions(["--host", "--resume"])).toEqual({mode: "background", seconds: 60});
  expect(startOptions(["--foreground", "--seconds", "90"])).toEqual({mode: "foreground", seconds: 90});
  expect(startOptions(["--foreground", "--direct-cdp"])).toEqual({mode: "direct", seconds: 60});
  for (const args of [["--direct-cdp"], ["--seconds", "30"], ["--foreground", "--seconds", "0"], ["--foreground", "--seconds", "301"], ["--foreground", "--foreground"], ["--keep-cookies"], ["--unknown"]]) expect(() => startOptions(args)).toThrow();
  expect(modeEndpoint({port: 1, webSocketDebuggerUrl: "ws://127.0.0.1:1/base"}).browserWSEndpoint).toBe("ws://127.0.0.1:1/base");
  expect(modeEndpoint({port: 1, directPort: 2, webSocketDebuggerUrl: "ws://127.0.0.1:1/base", interactionMode: "direct"}).browserWSEndpoint).toBe("ws://127.0.0.1:1/base/direct");
});

test("only explicit foreground/direct startup requests an approval", async () => {
  for (const mode of ["foreground", "direct"]) {
    const requests: {url: string; options: RequestInit}[] = [];
    const state = {mode: "host", focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", port: 1234, directPort: 1235,
      webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/fixture", userDataDir: "/fixture/profile"};
    const result = await requestHostResume(async (url: string, options: RequestInit) => {
      requests.push({url, options}); return Response.json(url.endsWith("/status") ? status : state);
    }, {mode, seconds: 30, targets: ["owned"]});
    expect(result.interactionMode).toBe(mode);
    expect(requests.map(request => request.url)).toEqual(["http://127.0.0.1:19222/status", "http://127.0.0.1:19222/foreground"]);
    expect(JSON.parse(requests[1]!.options.body as string)).toEqual({mode, seconds: 30, targets: ["owned"], confirmed: true});
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
