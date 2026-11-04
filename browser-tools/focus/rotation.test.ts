import {expect, test} from "bun:test";
import {requestProxyRotation} from "./host.js";
import {FOCUS_PROTOCOL} from "./client.js";

const state = {mode: "host", focusProtocol: FOCUS_PROTOCOL, browserId: "generation", networkMode: "proxy"};
const status = {focusProtocol: FOCUS_PROTOCOL, proxyRotation: "stop-before-relaunch-v1", networkMode: "proxy"};

test("rotation requires explicit idle confirmation and a pinned proxy generation before any request", async () => {
  for (const selected of [null, {...state, mode: "local"}, {...state, focusProtocol: "legacy"}, {...state, networkMode: "direct"}, {...state, browserId: "bad/id"}]) {
    let calls = 0;
    await expect(requestProxyRotation(selected, true, async () => { calls++; return Response.json(status); })).rejects.toThrow("FOCUS_BLOCKED");
    expect(calls).toBe(0);
  }
  await expect(requestProxyRotation(state, false)).rejects.toThrow("explicit approval");
});

test("legacy, stopped, direct and malformed broker status cannot trigger a stop", async () => {
  for (const capability of [{}, {...status, proxyRotation: undefined}, {...status, focusProtocol: "legacy"}, {...status, networkMode: null}, {...status, networkMode: "direct"}]) {
    const calls: string[] = [];
    await expect(requestProxyRotation(state, true, async url => { calls.push(url); return Response.json(capability); })).rejects.toThrow("nothing was stopped");
    expect(calls).toEqual(["http://127.0.0.1:19222/status"]);
  }
  await expect(requestProxyRotation(state, true, async () => new Response("invalid"))).rejects.toThrow("invalid proxy rotation status");
});

test("rotation sends only idle confirmation and the pinned generation, never a launch or budget", async () => {
  const calls: {url: string; options: RequestInit}[] = [];
  expect(await requestProxyRotation({...state, timeException: {token: "private-fixture"}}, true, async (url, options) => {
    calls.push({url, options});
    return Response.json(url.endsWith("/status") ? status : {stopped: true, networkMode: "proxy"});
  })).toEqual({stopped: true, networkMode: "proxy"});
  expect(calls.map(call => call.url)).toEqual(["http://127.0.0.1:19222/status", "http://127.0.0.1:19222/rotate-proxy"]);
  expect(JSON.parse(calls[1]!.options.body as string)).toEqual({expectedBrowserId: "generation", confirmedIdle: true});
  expect(calls[1]!.options.headers).toEqual({"x-browser-tools": "host-v1", "content-type": "application/json"});
});

test("stale requests and uncertain shutdowns are never retried or relaunched", async () => {
  for (const response of [Response.json({error: "FOCUS_BLOCKED: generation/network mismatch"}, {status: 409}),
    Response.json({error: "secret detail"}, {status: 409}), Response.json({stopped: false}), Response.json({stopped: true, networkMode: "direct"})]) {
    const calls: string[] = [];
    await expect(requestProxyRotation(state, true, async url => { calls.push(url); return url.endsWith("/status") ? Response.json(status) : response; })).rejects.toThrow("FOCUS_BLOCKED");
    expect(calls).toHaveLength(2);
  }
});

test("CLI help is offline and unknown/missing flags fail closed", async () => {
  const script = new URL("../browser-rotate.js", import.meta.url).pathname;
  const help = Bun.spawn([process.execPath, script, "--help"], {stdout: "pipe", stderr: "pipe"});
  expect(await help.exited).toBe(0);
  expect(await new Response(help.stdout).text()).toContain("No launch");
  for (const args of [[], ["--foreground"], ["--confirm-idle", "--network=direct"], ["--confirm-idle", "--seconds", "900"]]) {
    const child = Bun.spawn([process.execPath, script, ...args], {stdout: "pipe", stderr: "pipe"});
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("Explicit approval required");
  }
});
