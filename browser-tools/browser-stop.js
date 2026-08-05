#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { cdpUrl, clearState, cdpIsLive, readState } from "./browser-config.js";

const state = readState();
if (!state) {
	console.log("✓ No browser-tools browser is recorded for this devpod");
	process.exit(0);
}

try {
	if (await cdpIsLive(state.port)) {
		const browser = await puppeteer.connect({ browserURL: cdpUrl(state.port), defaultViewport: null });
		await browser.close();
	}
} finally {
	clearState();
}

console.log(`✓ Stopped browser on :${state.port} and cleared its devpod-local state`);
