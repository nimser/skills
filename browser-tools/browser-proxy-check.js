#!/usr/bin/env node
// Verify the configured proxy (AGENT_HTTPS_PROXY) is actually reachable and
// being used, by curling through it, e.g.:
//   curl -x "$AGENT_HTTPS_PROXY" https://api.ipify.org/
// and append the result to a history log for later reference.
//
// Usage: browser-proxy-check.js
// Exit 0 + prints the exit IP on success. Exit 1 if AGENT_HTTPS_PROXY is
// unset/invalid or the curl fails.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProxyConfig } from "./proxy-util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "..", "..", "artifacts", "proxy-ip-history.log");

const proxy = getProxyConfig();
if (!proxy) {
	console.error("✗ AGENT_HTTPS_PROXY is not set. Set it to a full proxy URL before running this check:");
	console.error('  export AGENT_HTTPS_PROXY="https://user:pass@host:port"');
	process.exit(1);
}

let ip;
try {
	ip = execFileSync("curl", ["-s", "-m", "10", "-x", proxy.raw, "https://api.ipify.org/"], {
		encoding: "utf8",
	}).trim();
} catch (e) {
	console.error("✗ curl through proxy failed:", e.message);
	process.exit(1);
}

if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
	console.error("✗ Unexpected response from ipify through proxy:", ip);
	process.exit(1);
}

const timestamp = new Date().toISOString();
mkdirSync(dirname(HISTORY_FILE), { recursive: true });
appendFileSync(HISTORY_FILE, `${timestamp}\t${ip}\n`);

console.log(`✓ Proxy active. Exit IP: ${ip} (logged to ${HISTORY_FILE})`);
