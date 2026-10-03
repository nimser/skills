#!/usr/bin/env node
// Dispatch a viewport CDP click to the owned tab, including closed shadow DOM.
import puppeteer from "puppeteer-core";
import { connectBrowser, ownedPage } from "./browser-config.js";

const [xArg, yArg] = process.argv.slice(2);
const x = Number(xArg), y = Number(yArg);
if (!Number.isFinite(x) || !Number.isFinite(y)) {
	console.error("Usage: browser-click-xy.js <x> <y>");
	process.exit(1);
}

const browser = await connectBrowser(puppeteer);
const page = await ownedPage(browser);
await page.mouse.click(x, y);
await browser.disconnect();
console.log(`Clicked at (${x}, ${y})`);
