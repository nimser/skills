#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { getProxyConfig } from "./proxy-util.js";

const useProfile = process.argv.includes("--profile");

if (process.argv.filter(a => a !== "--profile").length > 2) {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const SCRAPING_DIR = `${process.env.HOME}/.cache/browser-tools`;

// Detect platform and set browser path
function getBrowserPath() {
	const platform = process.platform;
	
	if (platform === "darwin") {
		const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
		try {
			readFileSync(chromePath);
			return { path: chromePath, type: "chrome" };
		} catch {}
	}
	
	if (platform === "linux") {
		// Try nix-profile Brave first (user preference)
		const bravePath = "/home/vscode/.nix-profile/bin/brave";
		try {
			readFileSync(bravePath);
			return { path: bravePath, type: "brave" };
		} catch {}
		
		// Try nix-profile Chrome
		const chromePath = "/home/vscode/.nix-profile/bin/google-chrome-stable";
		try {
			readFileSync(chromePath);
			return { path: chromePath, type: "chrome" };
		} catch {}
		
		// Try system paths
		const paths = [
			{ path: "/usr/bin/brave-browser", type: "brave" },
			{ path: "/usr/bin/brave", type: "brave" },
			{ path: "/usr/bin/google-chrome-stable", type: "chrome" },
			{ path: "/usr/bin/google-chrome", type: "chrome" },
			{ path: "/usr/bin/chromium-browser", type: "chromium" },
			{ path: "/usr/bin/chromium", type: "chromium" },
		];
		for (const { path, type } of paths) {
			try {
				readFileSync(path);
				return { path, type };
			} catch {}
		}
	}
	
	return null;
}

// Get browser startup flags based on platform and browser type
function getBrowserFlags(browserType) {
	const baseFlags = [
		"--remote-debugging-port=9222",
		`--user-data-dir=${SCRAPING_DIR}`,
		"--no-first-run",
		"--no-default-browser-check",
	];

	const proxy = getProxyConfig();
	if (proxy) {
		baseFlags.push(`--proxy-server=${proxy.serverFlag}`);
		console.log(`Using proxy: ${proxy.host}:${proxy.port} (auth handled per-page via page.authenticate)`);
	}
	
	if (process.platform === "linux") {
		const commonLinuxFlags = [
			"--disable-gpu",
			"--disable-software-rasterizer",
			"--disable-gpu-compositing",
			"--disable-gpu-rasterization",
			"--disable-dev-shm-usage",
			"--disable-features=UseOzonePlatform,UseGLX,UseEGL",
		];
		
		return [...baseFlags, "--no-sandbox", ...commonLinuxFlags];
	}
	
	return baseFlags;
}

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Browser already running on :9222");
	process.exit(0);
} catch {}

// Setup profile directory
execSync(`mkdir -p "${SCRAPING_DIR}"`, { stdio: "ignore" });

// Remove SingletonLock to allow new instance
try {
	execSync(`rm -f "${SCRAPING_DIR}/SingletonLock" "${SCRAPING_DIR}/SingletonSocket" "${SCRAPING_DIR}/SingletonCookie"`, { stdio: "ignore" });
} catch {}

if (useProfile && process.platform === "darwin") {
	console.log("Syncing profile...");
	execSync(
		`rsync -a --delete \
			--exclude='SingletonLock' \
			--exclude='SingletonSocket' \
			--exclude='SingletonCookie' \
			--exclude='*/Sessions/*' \
			--exclude='*/Current Session' \
			--exclude='*/Current Tabs' \
			--exclude='*/Last Session' \
			--exclude='*/Last Tabs' \
			"${process.env.HOME}/Library/Application Support/Google/Chrome/" "${SCRAPING_DIR}/"`,
		{ stdio: "pipe" },
	);
}

const browserInfo = getBrowserPath();
if (!browserInfo) {
	console.error("✗ No browser found. Please install Brave or Chrome.");
	process.exit(1);
}

const { path: browserPath, type: browserType } = browserInfo;
console.log(`Starting ${browserType} (${process.platform})...`);

// Start browser with flags to force new instance
spawn(
	browserPath,
	getBrowserFlags(browserType),
	{ detached: true, stdio: "ignore" },
).unref();

// Wait for browser to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error(`✗ Failed to connect to ${browserType}`);
	process.exit(1);
}

console.log(`✓ ${browserType} started on :9222${useProfile ? " with your profile" : ""}`);
