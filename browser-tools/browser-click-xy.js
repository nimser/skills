#!/usr/bin/env node
// One-off helper: real (CDP) mouse click at viewport coordinates. Needed when
// the target page uses closed shadow DOM (script-based clicks can't reach
// inside), so we simulate genuine user input instead — works regardless of
// encapsulation, same as a real click.
//
// Usage: browser-click-xy.js <x> <y>
import puppeteer from "puppeteer-core";
import { connectBrowser } from "./browser-config.js";

const [xArg, yArg] = process.argv.slice(2);
const x = Number(xArg), y = Number(yArg);
if (!Number.isFinite(x) || !Number.isFinite(y)) {
	console.error("Usage: browser-click-xy.js <x> <y>");
	process.exit(1);
}

const browser = await connectBrowser(puppeteer);
const pages = await browser.pages();
const page = pages[pages.length - 1];
await page.mouse.click(x, y);
await browser.disconnect();
console.log(`Clicked at (${x}, ${y})`);
