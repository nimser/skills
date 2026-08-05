#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { acquireStartupLock, cdpIsLive, cdpUrl, clearState, findAvailablePort, readState, runtimeDir, userDataDir, waitForCdp, writeState } from "./browser-config.js";
import { getProxyConfig } from "./proxy-util.js";

const useProfile = process.argv.includes("--profile");

if (process.argv.filter((arg) => arg !== "--profile").length > 2) {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Keep the container-local profile for logged-in sessions");
	process.exitCode = 1;
} else {
	function getBrowserPath() {
		if (process.platform === "darwin") {
			const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
			try {
				readFileSync(chromePath);
				return { path: chromePath, type: "chrome" };
			} catch {}
		}

		if (process.platform === "linux") {
			for (const [command, type] of [["brave", "brave"], ["brave-browser", "brave"], ["google-chrome-stable", "chrome"], ["google-chrome", "chrome"], ["chromium", "chromium"], ["chromium-browser", "chromium"]]) {
				try {
					const executable = execFileSync("which", [command], { encoding: "utf8" }).trim();
					if (executable) return { path: executable, type };
				} catch {}
			}
		}

		return null;
	}

	function browserFlags(port, profile) {
		const flags = [
			`--remote-debugging-port=${port}`,
			"--remote-debugging-address=127.0.0.1",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--no-default-browser-check",
		];

		const proxy = getProxyConfig();
		if (proxy) {
			flags.push(`--proxy-server=${proxy.serverFlag}`);
			console.log(`Using proxy: ${proxy.host}:${proxy.port} (auth handled per-page via page.authenticate)`);
		}

		if (process.platform === "linux") {
			flags.push(
				"--no-sandbox",
				"--disable-gpu",
				"--disable-software-rasterizer",
				"--disable-gpu-compositing",
				"--disable-gpu-rasterization",
				"--disable-dev-shm-usage",
				"--disable-features=UseOzonePlatform,UseGLX,UseEGL",
			);
		}

		return flags;
	}

	async function existingBrowser() {
		const state = readState();
		if (!state) return false;
		if (await cdpIsLive(state.port)) {
			console.log(`✓ Browser already running on :${state.port} with container-local profile`);
			return true;
		}
		clearState();
		return false;
	}

	async function main() {
		if (await existingBrowser()) return 0;

		const release = await acquireStartupLock();
		let child;
		try {
			if (await existingBrowser()) return 0;

			const browserInfo = getBrowserPath();
			if (!browserInfo) throw new Error("no supported browser found");

			const port = await findAvailablePort();
			const profile = userDataDir();
			mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
			mkdirSync(profile, { recursive: true, mode: 0o700 });

			if (useProfile && process.platform === "darwin") {
				console.log("Syncing profile into the container-local directory...");
				execFileSync("rsync", [
					"-a", "--delete",
					"--exclude=SingletonLock",
					"--exclude=SingletonSocket",
					"--exclude=SingletonCookie",
					"--exclude=*/Sessions/*",
					"--exclude=*/Current Session",
					"--exclude=*/Current Tabs",
					"--exclude=*/Last Session",
					"--exclude=*/Last Tabs",
					`${process.env.HOME}/Library/Application Support/Google/Chrome/`,
					`${profile}/`,
				], { stdio: "pipe" });
			}

			console.log(`Starting ${browserInfo.type} on ${cdpUrl(port)}...`);
			child = spawn(browserInfo.path, browserFlags(port, profile), { detached: true, stdio: "ignore" });
			child.unref();
			await waitForCdp(port);
			writeState({ port, userDataDir: profile, pid: child.pid, startedAt: new Date().toISOString() });
			console.log(`✓ ${browserInfo.type} started on :${port} with container-local profile${useProfile ? " (profile mode)" : ""}`);
			return 0;
		} catch (error) {
			if (child?.pid) {
				try {
					process.kill(child.pid, "SIGTERM");
				} catch {}
			}
			clearState();
			console.error(`✗ Failed to start browser: ${error.message}`);
			return 1;
		} finally {
			release();
		}
	}

	process.exitCode = await main();
}
