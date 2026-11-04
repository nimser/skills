import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {existsSync, rmSync, writeFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {actions, FOCUS_PROTOCOL, FocusDenied, parseLease, type Lease, type TimeException} from "./policy.ts";
import {gatewayPath, leasePath, readPrivateJson, writePrivateJson} from "./lease.ts";
import {TIME_EXCEPTIONS, validTimeException} from "./limits.js";

export function hostAgent(): string {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) throw new FocusDenied("time exceptions can only be issued on the host");
  const detection = spawnSync("systemd-detect-virt", ["--container"], {encoding: "utf8"});
  if (detection.error || detection.status !== 1) throw new FocusDenied("host execution could not be verified");
  const issuer = process.env.PI_SESSION_ID;
  if (!issuer) throw new FocusDenied("a third-party host agent session is required");
  return issuer;
}

export function exceptionGrant(args: string[], issuerSessionId: string, browserId: string, now = Date.now()): {lease: Lease; output: string; mode: "foreground" | "direct"} {
  let sessionId = "", until = "", output = "", direct = false;
  const targets: string[] = [], seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg !== "--target" && seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === "--session") sessionId = args[++index]!;
    else if (arg === "--until") until = args[++index]!;
    else if (arg === "--output") output = args[++index]!;
    else if (arg === "--target") targets.push(args[++index]!);
    else if (arg === "--direct-cdp") direct = true;
    else throw new Error("Use grant --session ID --until ISO_TIMESTAMP --target ID --output ABSOLUTE_FILE [--direct-cdp]");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(until) || !isAbsolute(output) || !targets.length) throw new FocusDenied("an explicit expiry with timezone, owned target and absolute receipt path are required");
  const timeException: TimeException = {version: 1, sessionId, issuerSessionId, issuedAt: now, expiresAt: Date.parse(until), token: randomBytes(32).toString("hex")};
  if (!validTimeException(timeException, now)) throw new FocusDenied("a time exception requires a different beneficiary session and a future expiry");
  const lease = parseLease({version: 1, browserId, issuedAt: now, expiresAt: timeException.expiresAt, targets,
    actions: actions.filter(action => direct || action !== "direct-cdp"), launch: false, timeException}, browserId, now);
  return {lease, output, mode: direct ? "direct" : "foreground"};
}

export async function issueException(args: string[]): Promise<void> {
  const issuer = hostAgent();
  const state = readPrivateJson(gatewayPath());
  if (state.focusProtocol !== FOCUS_PROTOCOL || state.mode !== "host" || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535) throw new FocusDenied("a running guarded browser is required");
  const response = await fetch(`http://127.0.0.1:${state.port}/json/version`, {signal: AbortSignal.timeout(1000)});
  const version = await response.json() as any;
  if (!response.ok || version.browserId !== state.browserId || version.focusProtocol !== FOCUS_PROTOCOL || version.timeExceptions !== TIME_EXCEPTIONS
    || version.webSocketDebuggerUrl !== state.webSocketDebuggerUrl) throw new FocusDenied("deploy the host time-exception gateway before issuing an exception");
  const {lease, output, mode} = exceptionGrant(args, issuer, state.browserId);
  writeFileSync(output, JSON.stringify({...state, interactionMode: mode, timeException: lease.timeException}) + "\n", {flag: "wx", mode: 0o600});
  try { writePrivateJson(leasePath(), lease); }
  catch (error) { rmSync(output, {force: true}); throw error; }
  console.log(`Time exception issued until ${new Date(lease.expiresAt).toISOString()}; private receipt: ${output}`);
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "grant") await issueException(args);
    else throw new Error("Use grant --session ID --until ISO_TIMESTAMP --target ID --output ABSOLUTE_FILE [--direct-cdp]; host third-party agent only");
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
