#!/usr/bin/env node

import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { connectBrowser, ownedPage } from "./browser-config.js";

const b = await connectBrowser(puppeteer).catch((e) => {
	console.error("✗ Could not connect to browser:", e.message);
	console.error("  Run: browser-start.js");
	process.exit(1);
});

const p = await ownedPage(b);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = `screenshot-${timestamp}.png`;
const filepath = join(tmpdir(), filename);

await p.screenshot({ path: filepath, fromSurface: true, captureBeyondViewport: false });

console.log(filepath);

await b.disconnect();
