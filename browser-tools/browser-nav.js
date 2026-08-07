#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { connectBrowser } from "./browser-config.js";
import { authenticatePage } from "./proxy-util.js";
import { DEFAULT_LOGIN_WAIT_MS, waitForManualLogin } from "./login-wait.js";

const args = process.argv.slice(2);
const newTab = args.includes("--new");
const reload = args.includes("--reload");
const skipLoginWait = args.includes("--no-login-wait");
const urlArg = args.find(a => !a.startsWith("--"));

if (!urlArg) {
	console.log("Usage: browser-nav.js <url> [--new] [--reload]");
	console.log("\nExamples:");
	console.log("  browser-nav.js https://example.com          # Navigate current tab");
	console.log("  browser-nav.js https://example.com --new    # Open in new tab");
	console.log("  browser-nav.js https://example.com --reload # Navigate and force reload");
	console.log(`\nA login wall pauses navigation for up to ${Math.round(DEFAULT_LOGIN_WAIT_MS / 1000)}s of manual login (--no-login-wait skips the pause).`);
	process.exit(1);
}

const url = /^[a-z][a-z\d+.-]*:\/\//i.test(urlArg) ? urlArg : `https://${urlArg}`;

const b = await connectBrowser(puppeteer).catch((e) => {
	console.error("✗ Could not connect to browser:", e.message);
	console.error("  Run: browser-start.js");
	process.exit(1);
});

const p = newTab ? await b.newPage() : (await b.pages()).at(-1);
await authenticatePage(p);
await p.goto(url, { waitUntil: "domcontentloaded" });
if (reload && !newTab) await p.reload({ waitUntil: "domcontentloaded" });
console.log(newTab ? "✓ Opened:" : "✓ Navigated to:", url);

const login = skipLoginWait ? { resolved: true } : await waitForManualLogin(p, { log: console.log });

await b.disconnect();
process.exit(login.resolved ? 0 : 2);
