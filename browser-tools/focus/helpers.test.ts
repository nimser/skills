import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {detectLoginWall} from "../login-wait.js";
import {requestHostResume} from "./host.js";
import {FOCUS_PROTOCOL} from "./client.js";

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
  const state = {mode: "host", focusProtocol: FOCUS_PROTOCOL, browserId: "fixture", port: 1234,
    webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/fixture", userDataDir: "/fixture/profile"};
  const result = await requestHostResume(async (url: string) => {
    requests.push(url);
    return Response.json(url.endsWith("/status") ? {focusProtocol: FOCUS_PROTOCOL, foregroundLeases: true, backgroundActions: 0} : state);
  });
  expect(result).toEqual(state);
  expect(requests).toEqual(["http://127.0.0.1:19222/status", "http://127.0.0.1:19222/resume"]);
});

test("all bundled browser helpers use the guarded client, not independent browser drivers", () => {
  const directory = new URL("../", import.meta.url);
  for (const name of readdirSync(directory).filter(name => /^browser-.*\.js$/.test(name) && !name.endsWith(".test.js"))) {
    const source = readFileSync(new URL(name, directory), "utf8");
    expect(source).not.toMatch(/import\s+.*(?:puppeteer|playwright)|puppeteer\.connect|new\s+WebSocket|bringToFront/);
  }
  expect(readFileSync(new URL("browser-config.js", directory), "utf8")).toContain("connectGuardedBrowser");
  expect(readFileSync(new URL("mappings/cli.ts", directory), "utf8")).not.toContain("puppeteer.connect");
});
