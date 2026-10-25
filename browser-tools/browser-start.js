#!/usr/bin/env node

import { connectBrowser, ensureOwnedPage, hostStartRoute, readState, writeState } from "./browser-config.js";
import { requestHostResume } from "./focus/host.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
	console.log("Usage: browser-start.js --host --resume\nRequires the private-pipe host gateway and an owner-issued foreground lease. Background automation, container-local launch and automatic website-data resets are unsupported.");
} else {
	try {
		if (process.env.AGENT_HTTPS_PROXY) throw new Error("--host does not inherit container proxies");
		const route = hostStartRoute(args);
		if (route !== "/resume") throw new Error("FOCUS_BLOCKED: automatic clean starts and tab resets are unsupported; use --host --resume after owner approval");
		const previous = readState();
		if (previous && previous.mode !== "host") throw new Error("FOCUS_BLOCKED: legacy local state must be detached explicitly; no browser was stopped");
		const state = await requestHostResume();
		writeState({...state, startedAt: new Date().toISOString()});
		const browser = await connectBrowser();
		try { await ensureOwnedPage(browser); } finally { await browser.disconnect(); }
		console.log("✓ Attached to the guarded host browser under foreground approval");
	} catch (error) {
		console.error(`✗ ${error.message}. No foreground fallback or retry was attempted.`);
		process.exitCode = 1;
	}
}
