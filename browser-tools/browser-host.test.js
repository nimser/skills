import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { clearState, connectBrowser, readState, writeState } from "./browser-config.js";

const directory = mkdtempSync(join(tmpdir(), "browser-host-test-"));
const previous = process.env.BROWSER_TOOLS_RUNTIME_DIR;
const previousState = process.env.BROWSER_TOOLS_STATE;
process.env.BROWSER_TOOLS_RUNTIME_DIR = directory;
const state = { mode: "host", port: 12345, userDataDir: "/host/profile", webSocketDebuggerUrl: "ws://127.0.0.1:12345/devtools/browser/test-identity" };
const script = (name, args = [], extra = {}) => spawnSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url)), ...args], {
  env: { ...process.env, BROWSER_TOOLS_STATE: join(directory, "state.json"), ...extra }, encoding: "utf8",
});
process.env.BROWSER_TOOLS_STATE = join(directory, "state.json");

test("host mode endpoint and lifecycle", async (t) => {
  try {
    await t.test("pins the WebSocket identity instead of rediscovering the port", async () => {
      writeState(state);
      let options;
      const result = await connectBrowser({ connect: async (value) => { options = value; return "connected"; } }, 20);
      assert.equal(result, "connected");
      assert.deepEqual(options, { browserWSEndpoint: state.webSocketDebuggerUrl, defaultViewport: null });
    });
    await t.test("refuses a missing or non-loopback host identity", async () => {
      for (const endpoint of [undefined, "ws://example.com:12345/devtools/browser/other"]) {
        writeState({ ...state, webSocketDebuggerUrl: endpoint });
        await assert.rejects(connectBrowser({ connect: () => { throw new Error("must not connect"); } }, 20), /invalid host browser identity/);
      }
    });
    await t.test("host stop detaches without contacting the browser", () => {
      writeState(state);
      const result = script("browser-stop.js");
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /shared host browser remains open/);
      assert.equal(readState(), undefined);
    });
    await t.test("rejects inherited proxy settings without replacing session state", () => {
      writeState(state);
      const result = script("browser-start.js", ["--host"], { AGENT_HTTPS_PROXY: "http://127.0.0.1:1" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /does not inherit container proxies/);
      assert.deepEqual(readState(), state);
    });
    await t.test("does not treat a host state as a local browser", () => {
      writeState(state);
      const result = script("browser-start.js");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /host mode is recorded/);
      assert.deepEqual(readState(), state);
    });
    await t.test("keeps local connections on the browser URL path", async () => {
      writeState({ port: 12345, userDataDir: "/container/profile" });
      let options;
      await connectBrowser({ connect: async (value) => { options = value; } }, 20);
      assert.deepEqual(options, { browserURL: "http://127.0.0.1:12345", defaultViewport: null });
    });
  } finally {
    clearState();
    rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BROWSER_TOOLS_RUNTIME_DIR;
    else process.env.BROWSER_TOOLS_RUNTIME_DIR = previous;
    if (previousState === undefined) delete process.env.BROWSER_TOOLS_STATE;
    else process.env.BROWSER_TOOLS_STATE = previousState;
  }
});
