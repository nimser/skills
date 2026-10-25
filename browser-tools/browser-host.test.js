import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {clearState, connectBrowser, ensureOwnedPage, hostStartRoute, newOwnedPage, ownedPage, readState, resolveCdpUrl, writeState} from "./browser-config.js";

const directory = mkdtempSync(join(tmpdir(), "browser-host-test-"));
const previous = process.env.BROWSER_TOOLS_RUNTIME_DIR;
const previousState = process.env.BROWSER_TOOLS_STATE;
process.env.BROWSER_TOOLS_RUNTIME_DIR = directory;
process.env.BROWSER_TOOLS_STATE = join(directory, "state.json");
const state = {mode: "host", port: 12345, userDataDir: "/host/profile", webSocketDebuggerUrl: "ws://127.0.0.1:12345/devtools/browser/legacy"};
const script = (name, args = [], extra = {}) => spawnSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url)), ...args], {
  env: {...process.env, ...extra}, encoding: "utf8", timeout: 5000,
});

test("host ownership and focus preflight without a real browser", async t => {
  try {
    await t.test("validates route arguments but does not allow a clean-start fallback", () => {
      assert.equal(hostStartRoute(["--host", "--resume"]), "/resume");
      for (const args of [["--keep-cookies"], ["--host", "--profile"], ["--host", "--keep-cookies", "--resume"], ["--host", "--unknown"]]) assert.throws(() => hostStartRoute(args), /Use --host/);
      for (const args of [[], ["--profile"], ["--host"], ["--host", "--keep-cookies"]]) {
        const result = script("browser-start.js", args);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /FOCUS_BLOCKED|Use --host/);
      }
    });
    await t.test("pins the explicit owned target, never the selected or newest target", async () => {
      const page = {name: "owned"};
      let ids = [{type: "page", targetId: "owned"}, {type: "page", targetId: "foreign"}];
      const requested = [];
      const browser = {wsEndpoint: () => state.webSocketDebuggerUrl,
        targetInfos: async () => ids, newOwnedPage: async () => ({page, targetId: "owned"}),
        page: async id => {requested.push(id); return page;}};
      assert.equal(await newOwnedPage(browser), page);
      assert.equal(JSON.parse(readFileSync(join(directory, "owned-tab.json"), "utf8")).targetId, "owned");
      assert.equal(await ownedPage(browser), page);
      assert.equal(await ensureOwnedPage(browser), page);
      assert.deepEqual(requested, ["owned", "owned"]);
      ids = [{type: "page", targetId: "foreign"}];
      await assert.rejects(ownedPage(browser), /owned tab was closed/);
      await assert.rejects(ensureOwnedPage(browser), /owned tab was closed/);
      browser.wsEndpoint = () => "ws://127.0.0.1:12345/devtools/browser/restarted";
      await assert.rejects(ownedPage(browser), /No owned tab/);
      clearState();
    });
    await t.test("all live entry points reject a legacy raw endpoint before connecting", async () => {
      writeState(state);
      assert.throws(() => resolveCdpUrl(), /FOCUS_BLOCKED/);
      await assert.rejects(connectBrowser({connect() { throw new Error("must not connect"); }}), /FOCUS_BLOCKED/);
      for (const [file, args] of [["browser-nav.js", ["https://example.test"]], ["browser-eval.js", ["document.title"]], ["browser-click-xy.js", ["10", "10"]], ["browser-screenshot.js", []], ["browser-content.js", ["https://example.test"]], ["browser-cookies.js", []], ["browser-login-wait.js", []], ["browser-pick.js", ["fixture"]]]) {
        const result = script(file, args);
        assert.equal(result.status, 1, `${file}: ${result.stderr}`);
        assert.match(result.stderr, /FOCUS_BLOCKED/, file);
      }
    });
    await t.test("environment flags and timer-disable flags do not grant foreground access", async () => {
      writeState(state);
      const result = script("browser-eval.js", ["document.title"], {BROWSER_GUARD_DISABLE: "1", BROWSER_CDP_URL: "http://127.0.0.1:1", BROWSER_TOOLS_FOREGROUND: "1"});
      assert.equal(result.status, 1);
      assert.match(result.stderr, /FOCUS_BLOCKED/);
    });
    await t.test("host stop only detaches, including a legacy recording", () => {
      writeState(state);
      const result = script("browser-stop.js");
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /remains open/);
      assert.equal(readState(), undefined);
    });
    await t.test("rejects proxy configuration without replacing recorded identity", () => {
      writeState(state);
      const result = script("browser-start.js", ["--host", "--resume"], {AGENT_HTTPS_PROXY: "http://127.0.0.1:1"});
      assert.equal(result.status, 1);
      assert.match(result.stderr, /does not inherit container proxies/);
      assert.deepEqual(readState(), state);
    });
  } finally {
    clearState();
    rmSync(directory, {recursive: true, force: true});
    if (previous === undefined) delete process.env.BROWSER_TOOLS_RUNTIME_DIR;
    else process.env.BROWSER_TOOLS_RUNTIME_DIR = previous;
    if (previousState === undefined) delete process.env.BROWSER_TOOLS_STATE;
    else process.env.BROWSER_TOOLS_STATE = previousState;
  }
});
