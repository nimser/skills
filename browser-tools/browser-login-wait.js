#!/usr/bin/env node
// Pause for a manual login on the active tab. Exit 0 when no login wall is
// present or the user signed in; exit 2 when the wait window expired.

import puppeteer from "puppeteer-core";
import { connectBrowser } from "./browser-config.js";
import { DEFAULT_LOGIN_WAIT_MS, waitForManualLogin } from "./login-wait.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	console.log("Usage: browser-login-wait.js [--seconds N]");
	console.log("\nWaits for the user to complete a manual login in the visible browser.");
	console.log(`Default window: ${Math.round(DEFAULT_LOGIN_WAIT_MS / 1000)}s (BROWSER_LOGIN_WAIT_MS).`);
	process.exit(0);
}

const secondsFlag = args.indexOf("--seconds");
const timeoutMs = secondsFlag === -1 ? DEFAULT_LOGIN_WAIT_MS : Number(args[secondsFlag + 1]) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
	console.error("✗ --seconds must be a positive number");
	process.exit(1);
}

const b = await connectBrowser(puppeteer).catch((e) => {
	console.error("✗ Could not connect to browser:", e.message);
	console.error("  Run: browser-start.js");
	process.exit(1);
});

const p = (await b.pages()).at(-1);
if (!p) {
	console.error("✗ No active tab found");
	process.exit(1);
}

const result = await waitForManualLogin(p, { timeoutMs, log: console.log });
await b.disconnect();

if (!result.loginWall) console.log("✓ No login wall on the active tab.");
process.exit(result.resolved ? 0 : 2);
