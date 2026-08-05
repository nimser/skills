#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";


const DEFAULT_PORT = 9222;
const MAX_PORT = 65535;
const STARTUP_LOCK_WAIT_MS = 10_000;

function env(name) {
	const value = process.env[name];
	return value && value.length > 0 ? value : undefined;
}

function safeInstance(value) {
	return (value || "default").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "default";
}

export function runtimeDir() {
	return env("BROWSER_TOOLS_RUNTIME_DIR") || path.join(os.tmpdir(), "browser-tools", safeInstance(env("BROWSER_TOOLS_INSTANCE") || env("PI_SESSION_ID")));
}

export function userDataDir() {
	return env("BROWSER_USER_DATA_DIR") || path.join(runtimeDir(), "profile");
}

export function stateFile() {
	return env("BROWSER_TOOLS_STATE") || path.join(runtimeDir(), "state.json");
}

function lockFile() {
	return path.join(runtimeDir(), "startup.lock");
}

export function cdpUrl(port) {
	return `http://127.0.0.1:${port}`;
}

function validPort(value) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw new Error(`invalid browser CDP port: ${value}`);
	return port;
}

function portFromUrl(value) {
	if (!value) return undefined;
	const url = new URL(value);
	return validPort(url.port || (url.protocol === "https:" ? 443 : 80));
}

export function requestedStartPort() {
	if (env("BROWSER_CDP_PORT")) return validPort(env("BROWSER_CDP_PORT"));
	if (env("BROWSER_CDP_URL")) return portFromUrl(env("BROWSER_CDP_URL"));
	return DEFAULT_PORT;
}

export function readState() {
	try {
		const state = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
		if (!Number.isInteger(state.port) || !state.userDataDir) return undefined;
		return state;
	} catch {
		return undefined;
	}
}

export function writeState(state) {
	fs.mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
	const temporary = `${stateFile()}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporary, stateFile());
}

export function clearState() {
	fs.rmSync(stateFile(), { force: true });
}

export async function cdpIsLive(port) {
	try {
		const response = await fetch(`${cdpUrl(port)}/json/version`, { signal: AbortSignal.timeout(1000) });
		return response.ok;
	} catch {
		return false;
	}
}

export function portIsAvailable(port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", () => resolve(false));
		server.listen({ host: "127.0.0.1", port }, () => {
			server.close(() => resolve(true));
		});
	});
}

export async function findAvailablePort(start = requestedStartPort()) {
	for (let port = start; port <= MAX_PORT; port += 1) {
		if (await portIsAvailable(port)) return port;
	}
	throw new Error(`no available browser CDP port at or above ${start}`);
}

export async function waitForCdp(port, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await cdpIsLive(port)) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`browser did not expose CDP on ${cdpUrl(port)} within ${timeoutMs}ms`);
}

export function resolveCdpUrl() {
	if (env("BROWSER_CDP_URL")) return env("BROWSER_CDP_URL").replace(/\/$/, "");
	if (env("BROWSER_CDP_PORT")) return cdpUrl(validPort(env("BROWSER_CDP_PORT")));
	const state = readState();
	if (state) return cdpUrl(state.port);
	throw new Error("no browser-tools session is recorded for this container; run browser-start.js first");
}

export async function connectBrowser(puppeteer, timeoutMs = 5000) {
	const url = resolveCdpUrl();
	return Promise.race([
		puppeteer.connect({ browserURL: url, defaultViewport: null }),
		new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout connecting to ${url}`)), timeoutMs)),
	]);
}

async function processExists(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function acquireStartupLock() {
	fs.mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
	const deadline = Date.now() + STARTUP_LOCK_WAIT_MS;
	for (;;) {
		try {
			const fd = fs.openSync(lockFile(), "wx", 0o600);
			fs.writeFileSync(fd, `${process.pid}\n`);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				try {
					fs.closeSync(fd);
				} finally {
					fs.rmSync(lockFile(), { force: true });
				}
			};
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			let owner;
			try {
				owner = Number(fs.readFileSync(lockFile(), "utf8").trim());
			} catch {
				owner = undefined;
			}
			if (!(await processExists(owner))) {
				fs.rmSync(lockFile(), { force: true });
				continue;
			}
			if (Date.now() >= deadline) throw new Error(`browser startup is locked by process ${owner}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}
