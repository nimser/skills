import { readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { connectBrowser, ownedPage } from "../browser-config.js";
import { parseMappings } from "./model.ts";
import { probePage } from "./probe.ts";

const usage = "Usage: bun cli.ts init FILE | validate FILE | check FILE PAGE_KEY [ELEMENT_KEY]";

export async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return 0;
  }
  const [command, file, pageKey, elementKey] = args;
  if (!file || !["init", "validate", "check"].includes(command ?? "")
    || (command === "check" ? args.length < 3 || args.length > 4 : args.length !== 2)) {
    console.error(usage);
    return 1;
  }
  if (command === "init") {
    try { await writeFile(file, '{\n  "version": 1,\n  "pages": {}\n}\n', { flag: "wx", mode: 0o600 }); }
    catch { console.error("Could not create mapping file; existing files are never overwritten"); return 1; }
    console.log("Created empty mappings; add only observed pages");
    return 0;
  }
  let input: unknown;
  try {
    if ((await stat(file)).size > 1_000_000) throw new Error();
    input = JSON.parse(await readFile(file, "utf8"));
  } catch { console.error("Could not read mappings; use valid JSON smaller than 1 MB"); return 1; }
  let mappings;
  try { mappings = parseMappings(input); }
  catch (error) { console.error((error as Error).message); return 1; }
  if (command === "validate") {
    console.log(`Valid schema: ${Object.keys(mappings.pages).length} page(s). Live selectors were not checked.`);
    return 0;
  }
  const mapping = mappings.pages[pageKey!];
  if (!mapping) { console.error("Unknown page key; nothing was checked"); return 1; }
  if (elementKey !== undefined && !Object.hasOwn(mapping.elements, elementKey)) {
    console.error("Unknown element key; nothing was checked"); return 1;
  }
  const guard = spawnSync(process.env.NODE_BINARY || "node", [fileURLToPath(new URL("../session-guard.js", import.meta.url)), "check"], { stdio: "inherit", env: process.env });
  if (guard.status !== 0) return 1;
  let browser;
  try { browser = await connectBrowser(puppeteer); }
  catch { console.error("Browser connection failed; start or resume browser-tools. No retry was attempted."); return 1; }
  try {
    const page = await ownedPage(browser);
    const result = await page.evaluate(probePage, mapping, elementKey);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 2;
  } catch {
    console.error("Owned-page inspection failed; verify the session and owned tab. No retry was attempted.");
    return 1;
  } finally {
    await browser.disconnect();
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
