import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { newOwnedPage, writeState } from "../browser-config.js";
import { fixtureMappings } from "./fixture.ts";
import { probePage } from "./probe.ts";

const html = '<form id="editor"><input id="title" type="text" value="PRIVATE"><button id="save" type="submit">Save</button></form>';
let browser: Browser;
let page: Page;
let server: ReturnType<typeof Bun.serve>;
let runtime: string;
let previousRuntime: string | undefined;
const testPages: Page[] = [];
let attached = false;

async function chromeExecutable(): Promise<string> {
  if (process.env.TEST_CHROME_EXECUTABLE) return process.env.TEST_CHROME_EXECUTABLE;
  const cache = join(homedir(), ".cache/ms-playwright");
  for (const entry of await readdir(cache).catch(() => [])) {
    const candidate = join(cache, entry, "chrome-linux64/chrome");
    if (entry.startsWith("chromium-") && existsSync(candidate)) return candidate;
  }
  throw new Error("Set TEST_CHROME_EXECUTABLE to a sandbox-capable Chromium executable for local integration tests");
}

beforeAll(async () => {
  runtime = await mkdtemp(join(tmpdir(), "browser-mappings-test-"));
  previousRuntime = process.env.BROWSER_TOOLS_RUNTIME_DIR;
  process.env.BROWSER_TOOLS_RUNTIME_DIR = runtime;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "Content-Type": "text/html" } }) });
  attached = !!process.env.TEST_BROWSER_WS_ENDPOINT;
  browser = attached
    ? await puppeteer.connect({ browserWSEndpoint: process.env.TEST_BROWSER_WS_ENDPOINT, defaultViewport: null })
    : await puppeteer.launch({ executablePath: await chromeExecutable(), headless: true, args: ["--remote-debugging-port=0"] });
  writeState({ port: Number(new URL(browser.wsEndpoint()).port), userDataDir: runtime,
    ...(attached ? { mode: "host", webSocketDebuggerUrl: browser.wsEndpoint() } : {}) });
  page = await newOwnedPage(browser);
  testPages.push(page);
  await page.goto(new URL("/editor", server.url).href);
}, 20_000);

afterAll(async () => {
  for (const testPage of testPages) await testPage.close().catch(() => {});
  if (attached) await browser?.disconnect();
  else await browser?.close();
  server?.stop(true);
  if (previousRuntime === undefined) delete process.env.BROWSER_TOOLS_RUNTIME_DIR;
  else process.env.BROWSER_TOOLS_RUNTIME_DIR = previousRuntime;
  if (runtime) await rm(runtime, { recursive: true, force: true });
});

describe("read-only live DOM checks on a loopback fixture", () => {
  test("checks context and targets without leaking field values or modifying the DOM", async () => {
    await page.setContent(html);
    const mapping = fixtureMappings(server.url.origin).pages.editor!;
    const before = await page.content();
    const result = await page.evaluate(probePage, mapping);
    expect(result.ok).toBe(true);
    expect(result.elements.preview?.status).toBe("missing");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(await page.content()).toBe(before);
  });

  test.each([
    ['<input id="title" type="text">', "ambiguous"],
    ['<style>#title {display: none}</style>', "hidden"],
    ['<script>document.querySelector("#title").disabled = true</script>', "disabled"],
    ['<script>document.querySelector("#title").type = "number"</script>', "mismatch"],
    ['<script>document.querySelector("#title").remove()</script>', "missing"],
  ] as const)("blocks changed targets: %s", async (extra, status) => {
    await page.setContent(html + extra);
    const result = await page.evaluate(probePage, fixtureMappings(server.url.origin).pages.editor!);
    expect(result.ok).toBe(false);
    expect(result.elements.title?.status).toBe(status);
  });

  test("scopes an action precondition without weakening context markers", async () => {
    await page.setContent(html + '<script>document.querySelector("#save").disabled = true</script>');
    const mapping = fixtureMappings(server.url.origin).pages.editor!;
    expect((await page.evaluate(probePage, mapping)).ok).toBe(false);
    expect((await page.evaluate(probePage, mapping, "title")).ok).toBe(true);
    expect((await page.evaluate(probePage, mapping, "save")).ok).toBe(false);
    expect((await page.evaluate(probePage, mapping, "preview")).ok).toBe(false);
    expect((await page.evaluate(probePage, mapping, "unknown")).context).toBe("unknown-element");
    expect((await page.evaluate(probePage, { ...mapping, markers: [{ selector: "#missing" }] }, "title")).context).toBe("marker-mismatch");
  });

  test("filters exact structural text without guessing among buttons or leaking labels", async () => {
    await page.setContent(html + '<button type="submit">Publish</button><button type="button">  Re\u0301fe\u0301rentiels\n </button>');
    const mapping = fixtureMappings(server.url.origin).pages.editor!;
    mapping.elements.save = { selector: "button[type=submit]", text: "Save", risk: "persist", required: true };
    mapping.markers.push({ selector: "button[type=button]", text: "Référentiels" });
    const result = await page.evaluate(probePage, mapping, "save");
    expect(result.ok).toBe(true);
    expect(result.elements.save?.matches).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Publish");
    mapping.elements.save.text = "save";
    expect((await page.evaluate(probePage, mapping, "save")).elements.save?.status).toBe("missing");
    mapping.elements.save.text = "Sav";
    expect((await page.evaluate(probePage, mapping, "save")).ok).toBe(false);
    mapping.elements.save.text = "Save";
    await page.setContent(html + '<button type="submit" hidden>Save</button><button type="button">Référentiels</button>');
    expect((await page.evaluate(probePage, mapping, "save")).elements.save?.status).toBe("ambiguous");
  });

  test("blocks invalid CSS, including non-standard :contains selectors", async () => {
    await page.setContent(html);
    const mapping = fixtureMappings(server.url.origin).pages.editor!;
    mapping.elements.save!.selector = 'button:contains("Save")';
    const result = await page.evaluate(probePage, mapping);
    expect(result.elements.save?.status).toBe("invalid-selector");
    expect(result.ok).toBe(false);
  });

  test("blocks wrong origins, routes, state markers and visible login fields", async () => {
    await page.setContent(html);
    const mapping = fixtureMappings(server.url.origin).pages.editor!;
    expect((await page.evaluate(probePage, { ...mapping, origin: "https://example.test" })).context).toBe("wrong-route");
    expect((await page.evaluate(probePage, { ...mapping, pathname: "/other" })).context).toBe("wrong-route");
    expect((await page.evaluate(probePage, { ...mapping, markers: [{ selector: "#missing" }] })).context).toBe("marker-mismatch");
    await page.setContent(html + '<input type="password" value="SECRET">');
    const result = await page.evaluate(probePage, mapping);
    expect(result.context).toBe("login-wall");
    expect(result.elements).toEqual({});
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("CLI validates offline, refuses overwrites, requires a timer and checks only the owned tab", async () => {
    await page.setContent(html);
    const file = join(runtime, "browser-mappings.json");
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const run = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { out, err, code };
    };
    expect((await run(["init", file])).code).toBe(0);
    expect((await run(["init", file])).code).toBe(1);
    await writeFile(file, JSON.stringify(fixtureMappings(server.url.origin)));
    expect((await run(["validate", file])).code).toBe(0);
    expect((await run(["check", file, "editor"])).code).toBe(1);
    await writeFile(join(runtime, "session-guard.state"), `${Date.now() - 120_000}\t1`);
    const expired = await run(["check", file, "editor"]);
    expect(expired.code).toBe(1);
    expect(expired.err).toContain("EXPIRED");
    await writeFile(join(runtime, "session-guard.state"), `${Date.now()}\t1`);
    const otherTab = await newOwnedPage(browser);
    testPages.push(otherTab);
    await otherTab.goto(new URL("/unowned", server.url).href);
    await writeFile(join(runtime, "owned-tab.json"), JSON.stringify({ endpoint: browser.wsEndpoint(), targetId: await page.target().createCDPSession().then(async client => {
      try { return (await client.send("Target.getTargetInfo")).targetInfo.targetId; }
      finally { await client.detach(); }
    }) }));
    const result = await run(["check", file, "editor"]);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('"ok": true');
    expect(result.out).not.toContain("PRIVATE");
    await page.goto(new URL("/wrong", server.url).href);
    expect((await run(["check", file, "editor"])).code).toBe(2);
    await page.close();
    const closed = await run(["check", file, "editor"]);
    expect(closed.code).toBe(1);
    expect(closed.err).toContain("Owned-page inspection failed");
    expect(otherTab.url()).toContain("/unowned");
  }, 30_000);
});
