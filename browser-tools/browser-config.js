#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";

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
	return path.join(os.tmpdir(), "browser-tools", "startup.lock");
}

export function hostStartRoute(args) {
	if (!args.includes("--host") || args.some(arg => !["--host", "--keep-cookies", "--resume"].includes(arg))
		|| new Set(args).size !== args.length || (args.includes("--keep-cookies") && args.includes("--resume"))) {
		throw new Error("Use --host [--keep-cookies|--resume]; --profile is container-local only");
	}
	return args.includes("--resume") ? "/resume" : args.includes("--keep-cookies") ? "/start-keep-cookies" : "/start";
}

export function cdpUrl(port) {
	return `http://127.0.0.1:${port}`;
}

function validPort(value) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw new Error(`invalid browser CDP port: ${value}`);
	return port;
}

export function requestedStartPort() {
	if (env("BROWSER_CDP_PORT")) return validPort(env("BROWSER_CDP_PORT"));
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

function ownedTabFile() {
	return path.join(runtimeDir(), "owned-tab.json");
}

export function clearState() {
	fs.rmSync(stateFile(), { force: true });
	fs.rmSync(ownedTabFile(), { force: true });
}

async function targetId(target) {
	const client = await target.createCDPSession();
	try {
		return (await client.send("Target.getTargetInfo")).targetInfo.targetId;
	} finally {
		await client.detach();
	}
}

function saveOwnedTab(browser, id) {
	fs.mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
	const temporary = `${ownedTabFile()}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, JSON.stringify({ endpoint: browser.wsEndpoint(), targetId: id }) + "\n", { mode: 0o600 });
	fs.renameSync(temporary, ownedTabFile());
}

export async function ownedPage(browser) {
	let saved;
	try { saved = JSON.parse(fs.readFileSync(ownedTabFile(), "utf8")); } catch {}
	if (!saved || saved.endpoint !== browser.wsEndpoint() || typeof saved.targetId !== "string") {
		throw new Error("No owned tab for this browser; run browser-start.js --host --resume or browser-nav.js <URL> --new");
	}
	for (const target of browser.targets()) {
		if (target.type() !== "page") continue;
		let id;
		try { id = await targetId(target); } catch { continue; }
		if (id === saved.targetId) {
			const page = await target.page();
			if (page) return page;
		}
	}
	throw new Error("The owned tab was closed; use browser-nav.js <URL> --new. Other tabs were not selected");
}

export async function newOwnedPage(browser) {
	const client = await browser.target().createCDPSession();
	const url = `about:blank#browser-tools-${randomUUID()}`;
	let id;
	try {
		({ targetId: id } = await client.send("Target.createTarget", { url, background: true }));
		const target = await browser.waitForTarget(candidate => candidate.type() === "page" && candidate.url() === url, { timeout: 5000 });
		const page = await target.page();
		if (!page) throw new Error("The owned background tab is unavailable");
		saveOwnedTab(browser, id);
		return page;
	} catch (error) {
		if (id) await client.send("Target.closeTarget", { targetId: id }).catch(() => {});
		throw error;
	} finally {
		await client.detach();
	}
}

export async function ensureOwnedPage(browser) {
	try { return await ownedPage(browser); } catch { return newOwnedPage(browser); }
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
	const state = readState();
	if (state) return cdpUrl(state.port);
	if (env("BROWSER_CDP_URL")) return env("BROWSER_CDP_URL").replace(/\/$/, "");
	if (env("BROWSER_CDP_PORT")) return cdpUrl(validPort(env("BROWSER_CDP_PORT")));
	throw new Error("no browser-tools session is recorded for this container; run browser-start.js first");
}

export async function connectBrowser(puppeteer, timeoutMs = 5000) {
	const url = resolveCdpUrl();
	const state = readState();
	if (state?.mode === "host" && !state.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${state.port}/devtools/browser/`)) {
		throw new Error("invalid host browser identity; run browser-start.js --host --resume");
	}
	const endpoint = state?.mode === "host" ? { browserWSEndpoint: state.webSocketDebuggerUrl } : { browserURL: url };
	return Promise.race([
		puppeteer.connect({ ...endpoint, defaultViewport: null }),
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
	fs.mkdirSync(path.dirname(lockFile()), { recursive: true, mode: 0o700 });
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
