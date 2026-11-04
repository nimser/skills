import {afterAll, expect, test} from "bun:test";
import {spawnSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {exceptionGrant} from "./exception.ts";
import {approveForeground} from "./lease.ts";
import {checkSessionBudget} from "./client.js";
import {FocusPolicy, parseLease} from "./policy.ts";
import {exceptionRemaining, FOREGROUND_SECONDS, TASK_MINUTES, TIME_EXCEPTIONS} from "./limits.js";
import {modeEndpoint} from "./mode.js";

const temporary = mkdtempSync(join(tmpdir(), "browser-limits-"));
const issuer = "00000000-0000-0000-0000-000000000001", beneficiary = "00000000-0000-0000-0000-000000000002";
const now = Date.now();
const until = new Date(now + 2 * 60 * 60_000).toISOString();
const args = ["--session", beneficiary, "--until", until, "--target", "owned", "--output", join(temporary, "receipt.json")];
const grant = () => exceptionGrant(args, issuer, "fixture-browser", now);
const script = (name: string, args: string[], env: Record<string, string | undefined> = {}) => Bun.spawn([process.execPath, fileURLToPath(new URL(name, import.meta.url)), ...args], {
  env: {...process.env, BROWSER_TOOLS_RUNTIME_DIR: temporary, BROWSER_TOOLS_STATE: join(temporary, "state.json"), BROWSER_SESSION_GUARD_STATE: join(temporary, "timer"), ...env}, stdout: "pipe", stderr: "pipe",
});
afterAll(() => rmSync(temporary, {recursive: true, force: true}));

test("defaults are fifteen minutes foreground and ninety minutes per task", () => {
  expect(FOREGROUND_SECONDS).toBe(900);
  expect(TASK_MINUTES).toBe(90);
  for (const request of [
    {mode: "foreground", confirmed: true, seconds: 901, targets: []},
    {mode: "foreground", confirmed: true, seconds: 900, targets: [], timeException: grant().lease.timeException},
    {mode: "foreground", confirmed: true, seconds: 900, targets: [], sessionId: beneficiary},
  ]) expect(() => approveForeground(request)).toThrow("explicit bounded foreground approval");
});

test("exceptions require a distinct issuer, explicit zoned expiry, target and private receipt path", () => {
  const {lease} = grant();
  expect(lease.launch).toBe(false);
  expect(lease.timeException!.sessionId).toBe(beneficiary);
  expect(lease.actions).not.toContain("direct-cdp");
  expect(parseLease(lease, "fixture-browser", now)).toEqual(lease);
  expect(exceptionGrant([...args, "--direct-cdp"], issuer, "fixture-browser", now).lease.actions).toContain("direct-cdp");
  for (const bad of [
    args.map(value => value === beneficiary ? issuer : value),
    args.map(value => value === until ? "2099-01-01T12:00:00" : value),
    args.map(value => value === until ? new Date(now).toISOString() : value),
    args.filter(value => !["--target", "owned"].includes(value)),
    args.map(value => value === join(temporary, "receipt.json") ? "relative.json" : value),
    [...args, "--issuer", beneficiary], [...args, "--session", beneficiary],
  ]) expect(() => exceptionGrant(bad, issuer, "fixture-browser", now)).toThrow();
  expect(() => exceptionGrant(args, "", "fixture-browser", now)).toThrow();
  expect(() => parseLease({...lease, launch: true}, "fixture-browser", now)).toThrow();
  expect(() => parseLease({...lease, expiresAt: lease.expiresAt + 1}, "fixture-browser", now)).toThrow();
  expect(() => parseLease(lease, "fixture-browser", lease.expiresAt)).toThrow();
});

test.each([
  ["1s", 1000], ["30m", 30 * 60_000], ["8h", 8 * 60 * 60_000], ["2d", 2 * 24 * 60 * 60_000],
] as const)("a %s exception duration fixes both deadlines at issuance", (duration, milliseconds) => {
  const relative = args.map(value => value === "--until" ? "--duration" : value === until ? duration : value);
  const {lease} = exceptionGrant(relative, issuer, "fixture-browser", now);
  expect(lease.issuedAt).toBe(now);
  expect(lease.expiresAt).toBe(now + milliseconds);
  expect(lease.timeException!.expiresAt).toBe(lease.expiresAt);
  expect(exceptionRemaining(lease.timeException, beneficiary, now + milliseconds - 1)).toBe(1);
  expect(() => exceptionRemaining(lease.timeException, beneficiary, lease.expiresAt)).toThrow("expired");
  expect(() => exceptionGrant(relative, beneficiary, "fixture-browser", now)).toThrow("different beneficiary");
});

test("exception time options reject ambiguity, missing values, malformed durations and overflow", () => {
  const untimed = args.filter(value => value !== "--until" && value !== until);
  for (const bad of [
    untimed, [...args, "--duration", "8h"], [...args, "--duration", ""],
    [...untimed, "--until"], [...untimed, "--duration"], [...untimed, "--duration", "8h", "--duration", "8h"],
    ...["", "0h", "-8h", "+8h", "1.5h", "8", "8hours", "8H", " 8h", "8h ", "1h30m", "Infinityh", "9007199254740992s", "100000001d"].map(duration => [...untimed, "--duration", duration]),
  ]) expect(() => exceptionGrant(bad, issuer, "fixture-browser", now)).toThrow();
});

test("an exceptional lease cannot be reused by normal clients or a different capability", () => {
  const {lease} = grant();
  for (const token of [undefined, "a".repeat(64)]) expect(() => new FocusPolicy("fixture-browser", () => lease, () => now, "foreground", undefined, token).connectionAllowed()).toThrow("beneficiary capability");
  const policy = new FocusPolicy("fixture-browser", () => lease, () => now, "foreground", undefined, lease.timeException!.token);
  expect(() => policy.connectionAllowed()).not.toThrow();
  expect(() => new FocusPolicy("fixture-browser", () => lease, () => now, "direct", undefined, lease.timeException!.token).connectionAllowed()).toThrow("separate browser-wide");
  const background = new FocusPolicy("fixture-browser", () => lease, () => now);
  expect(() => background.connectionAllowed()).not.toThrow();
  expect(() => background.authorize({id: 1, method: "Runtime.evaluate"})).toThrow("passive");
});

test("the beneficiary capability has a fixed task deadline and cannot change sessions", () => {
  const {lease} = grant(), value = lease.timeException!;
  expect(exceptionRemaining(value, beneficiary, now)).toBe(2 * 60 * 60_000);
  expect(() => exceptionRemaining(value, issuer, now)).toThrow("another agent session");
  expect(() => exceptionRemaining(value, beneficiary, value.expiresAt)).toThrow("expired");
  const previous = process.env.PI_SESSION_ID;
  process.env.PI_SESSION_ID = beneficiary;
  try {
    const state = {port: 1, directPort: 2, interactionMode: "foreground", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/browser/fixture-browser", timeException: value};
    expect(modeEndpoint(state).browserURL).toBe(`http://127.0.0.1:1/foreground/exception/${value.token}`);
    expect(modeEndpoint({...state, interactionMode: "direct"}).metadataURL).toBe(`http://127.0.0.1:2/exception/${value.token}/json/version`);
    expect(modeEndpoint({...state, interactionMode: "direct"}).browserURL).toBeUndefined();
    expect(checkSessionBudget(temporary, value)).toBeGreaterThan(90 * 60_000);
  } finally {
    if (previous === undefined) delete process.env.PI_SESSION_ID;
    else process.env.PI_SESSION_ID = previous;
  }
});

test("normal task timers reject oversized, malformed and expired budgets", () => {
  const key = process.env.BROWSER_SESSION_GUARD_STATE;
  process.env.BROWSER_SESSION_GUARD_STATE = join(temporary, "timer-validation");
  try {
    writeFileSync(process.env.BROWSER_SESSION_GUARD_STATE, `${Date.now()}\t90`);
    expect(checkSessionBudget(temporary)).toBeGreaterThan(89 * 60_000);
    for (const text of [`${Date.now()}\t91`, `${Date.now()}\t0`, `${Date.now()}\t1.5`, `${Date.now() - 90 * 60_000}\t90`, "NaN\t90", `${Date.now()}\t90\textra`]) {
      writeFileSync(process.env.BROWSER_SESSION_GUARD_STATE, text);
      expect(() => checkSessionBudget(temporary)).toThrow("invalid or EXPIRED");
    }
  } finally {
    if (key === undefined) delete process.env.BROWSER_SESSION_GUARD_STATE;
    else process.env.BROWSER_SESSION_GUARD_STATE = key;
  }
});

test("timer CLI defaults to ninety minutes, never overwrites a timer and rejects self-extension", async () => {
  const child = script("../session-guard.js", ["start"]);
  expect(await child.exited).toBe(0);
  const original = readFileSync(join(temporary, "timer"), "utf8");
  expect(original.split("\t")[1]).toBe("90");
  const duplicate = script("../session-guard.js", ["start", "90"]);
  expect(await duplicate.exited).toBe(1);
  expect(await new Response(duplicate.stderr).text()).toContain("third-party host exception");
  expect(readFileSync(join(temporary, "timer"), "utf8")).toBe(original);
  rmSync(join(temporary, "timer"));
  for (const minutes of ["91", "0", "NaN", "1.5"]) {
    const invalid = script("../session-guard.js", ["start", minutes]);
    expect(await invalid.exited).toBe(1);
    expect(await new Response(invalid.stderr).text()).toContain("1..90");
  }
});

test("host exception issuance verifies gateway capability, refuses self-grants and writes a private receipt", async () => {
  const focus = join(temporary, "host-issuance");
  mkdirSync(focus, {mode: 0o700});
  let capable = false;
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(): Response {
    return Response.json({browserId: "fixture-browser", focusProtocol: "browser-tools-focus-v2", webSocketDebuggerUrl: state.webSocketDebuggerUrl, ...(capable ? {timeExceptions: TIME_EXCEPTIONS} : {})});
  }});
  const state = {mode: "host", port: server.port, directPort: server.port! + 1, browserId: "fixture-browser", focusProtocol: "browser-tools-focus-v2", userDataDir: "/fixture/profile", webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/fixture-browser`};
  writeFileSync(join(focus, "gateway.json"), JSON.stringify(state), {mode: 0o600});
  const output = join(temporary, "cli-receipt.json");
  const cliArgs = args.map(value => value === join(temporary, "receipt.json") ? output : value === "--until" ? "--duration" : value === until ? "8h" : value);
  const env = {PI_SESSION_ID: issuer, BROWSER_TOOLS_FOCUS_RUNTIME_DIR: focus};
  try {
    const legacy = script("exception.ts", ["grant", ...cliArgs], env);
    expect(await legacy.exited).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(existsSync(join(focus, "foreground.json"))).toBe(false);
    const verifiedHost = !existsSync("/.dockerenv") && !existsSync("/run/.containerenv") && spawnSync("systemd-detect-virt", ["--container"]).status === 1;
    if (!verifiedHost) return;
    expect(await new Response(legacy.stderr).text()).toContain("exception gateway");
    capable = true;
    const self = script("exception.ts", ["grant", ...cliArgs], {...env, PI_SESSION_ID: beneficiary});
    expect(await self.exited).toBe(1);
    expect(existsSync(output)).toBe(false);
    const issued = script("exception.ts", ["grant", ...cliArgs], env);
    expect(await issued.exited).toBe(0);
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    expect(receipt.timeException.issuerSessionId).toBe(issuer);
    expect(receipt.timeException.sessionId).toBe(beneficiary);
    expect(receipt.timeException.expiresAt - receipt.timeException.issuedAt).toBe(8 * 60 * 60_000);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(await new Response(issued.stdout).text()).not.toContain(receipt.timeException.token);
    const lease = JSON.parse(readFileSync(join(focus, "foreground.json"), "utf8"));
    expect(parseLease(lease, "fixture-browser").timeException!.token).toBe(receipt.timeException.token);
    const repeated = script("exception.ts", ["grant", ...cliArgs], env);
    expect(await repeated.exited).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(receipt);
  } finally { server.stop(true); }
});

test("exception CLI refuses non-host execution and missing agent identity before touching approvals", async () => {
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const detector = join(bin, "systemd-detect-virt");
  writeFileSync(detector, "#!/bin/sh\nexit 0\n");
  chmodSync(detector, 0o700);
  const nonHost = script("exception.ts", ["grant", ...args], {PI_SESSION_ID: issuer, PATH: `${bin}:${process.env.PATH}`});
  expect(await nonHost.exited).toBe(1);
  expect(await new Response(nonHost.stderr).text()).toMatch(/host execution|only be issued on the host/);
  const missingAgent = script("exception.ts", ["grant", ...args], {PI_SESSION_ID: ""});
  expect(await missingAgent.exited).toBe(1);
  expect(await new Response(missingAgent.stderr).text()).toMatch(/third-party host agent|only be issued on the host|host execution/);
});
