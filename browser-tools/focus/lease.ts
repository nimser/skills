import {constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomBytes, randomUUID} from "node:crypto";
import {actions, FocusDenied, parseLease, type Lease} from "./policy.ts";
import {FOREGROUND_SECONDS, sessionIdPattern, validDuration} from "./limits.js";

export function focusDirectory(): string {
  return process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR || join(process.env.XDG_RUNTIME_DIR || tmpdir(), `browser-tools-focus-${process.getuid?.()}`);
}
export const leasePath = () => join(focusDirectory(), "window.json");
export const gatewayPath = () => join(focusDirectory(), "gateway.json");
export function readPrivateJson(file: string): any {
  assertPrivateDirectory();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 16_384) throw new FocusDenied("unsafe runtime file");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function assertPrivateDirectory(): void {
  const directory = focusDirectory();
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) || realpathSync(directory) !== directory) throw new FocusDenied("unsafe focus runtime directory");
}
export function writePrivateJson(file: string, value: unknown): void {
  mkdirSync(focusDirectory(), {recursive: true, mode: 0o700});
  assertPrivateDirectory();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", {flag: "wx", mode: 0o600});
    renameSync(temporary, file);
  } finally { rmSync(temporary, {force: true}); }
}
export function readLease(): unknown {
  try {
    const lease = readPrivateJson(leasePath());
    if (lease?.window) return lease;
  } catch {}
  throw new FocusDenied("no valid desktop-confirmed browser window");
}
export function consumeLaunch(now = Date.now()): Lease {
  assertPrivateDirectory();
  const lock = join(focusDirectory(), "launch.lock");
  const fd = openSync(lock, "wx", 0o600);
  try {
    const value = readLease() as Lease;
    const lease = parseLease(value, value?.browserId, now);
    if (!lease.launch) throw new FocusDenied("a fresh owner-issued launch lease is required");
    writePrivateJson(leasePath(), {...lease, launch: false});
    return lease;
  } finally { closeSync(fd); rmSync(lock, {force: true}); }
}
export interface WindowRequest {
  mode: "foreground" | "direct";
  seconds: number;
  sessionId: string;
  targets: string[];
  pinnedBrowserId?: string;
}

export function parseWindowRequest(raw: unknown): WindowRequest {
  const request = raw as WindowRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).some(key => !["mode", "seconds", "sessionId", "targets", "pinnedBrowserId"].includes(key))
    || (request.mode !== "foreground" && request.mode !== "direct")
    || typeof request.sessionId !== "string" || !sessionIdPattern.test(request.sessionId)
    || (request.seconds !== undefined && !validDuration(request.seconds))
    || !Array.isArray(request.targets) || request.targets.length > 1
    || !request.targets.every(id => typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id))
    || (request.targets.length > 0 && request.pinnedBrowserId === undefined)
    || (request.pinnedBrowserId !== undefined && (typeof request.pinnedBrowserId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(request.pinnedBrowserId)))) {
    throw new FocusDenied("invalid browser window request");
  }
  return {...request, seconds: request.seconds ?? FOREGROUND_SECONDS};
}

export function windowLease(request: WindowRequest, runningBrowserId?: string, now = Date.now()): Lease {
  const browserId = runningBrowserId ?? randomUUID();
  const {sessionId, mode, seconds, pinnedBrowserId, targets} = request;
  return parseLease({version: 1, browserId, issuedAt: now, expiresAt: now + seconds * 1000,
    targets: runningBrowserId && pinnedBrowserId === runningBrowserId ? targets : [],
    actions: actions.filter(action => mode === "direct" || action !== "direct-cdp"), launch: !runningBrowserId,
    window: {sessionId, token: randomBytes(32).toString("hex")}}, browserId, now);
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "--help") {
      console.log("Use status or revoke. To request a new window, run browser-start.js --foreground from the Pi session and confirm on the desktop.");
    } else if (command === "status" && !args.length) {
      const gateway = readPrivateJson(gatewayPath());
      const lease = parseLease(readLease(), gateway.browserId);
      console.log(JSON.stringify({active: true, expiresAt: lease.expiresAt, actions: lease.actions, targetCount: lease.targets.length}));
    } else if (command === "revoke" && !args.length) {
      rmSync(leasePath(), {force: true});
      console.log("Foreground lease revoked; sent actions can have uncertain outcomes.");
    } else throw new Error("Use --help for browser window commands");
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
