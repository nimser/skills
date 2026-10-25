import {constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {createInterface} from "node:readline/promises";
import {actions, FocusDenied, parseLease, type Lease} from "./policy.ts";

export function focusDirectory(): string {
  return process.env.BROWSER_TOOLS_FOCUS_RUNTIME_DIR || join(process.env.XDG_RUNTIME_DIR || tmpdir(), `browser-tools-focus-${process.getuid?.()}`);
}
export const leasePath = () => join(focusDirectory(), "foreground.json");
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
  try { return readPrivateJson(leasePath()); } catch { throw new FocusDenied("no valid owner-issued foreground lease"); }
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
export function grantArguments(args: string[], browserId: string, now = Date.now()): Lease {
  let seconds = 60, launch = false;
  let targets: string[] = [], selected: Lease["actions"] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--launch") launch = true;
    else if (arg === "--seconds") seconds = Number(args[++index]);
    else if (arg === "--target") targets.push(args[++index]!);
    else if (arg === "--actions") selected = args[++index]?.split(",") as Lease["actions"];
    else throw new Error("Use grant [--launch] --actions ACTIONS [--target ID] [--seconds 1..300]");
  }
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300 || !selected?.length || (!launch && !targets.length)) throw new Error("Specify bounded actions, duration and an owned target, or --launch");
  return parseLease({version: 1, browserId, issuedAt: now, expiresAt: now + seconds * 1000, targets, actions: selected, launch}, browserId, now);
}

if (import.meta.main) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "--help") {
      console.log(`Owner-only foreground leases. Actions: ${actions.join(",")}.\nUse grant [--launch] --actions ACTIONS [--target ID] [--seconds 1..300], status or revoke.`);
    } else if (command === "status" && !args.length) {
      const gateway = readPrivateJson(gatewayPath());
      const lease = parseLease(readLease(), gateway.browserId);
      console.log(JSON.stringify({active: true, expiresAt: lease.expiresAt, actions: lease.actions, targetCount: lease.targets.length}));
    } else if (command === "revoke" && !args.length) {
      rmSync(leasePath(), {force: true});
      console.log("Foreground lease revoked; sent actions can have uncertain outcomes.");
    } else if (command === "grant") {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new FocusDenied("grant must be run by the owner in an interactive terminal");
      const launch = args.includes("--launch");
      if (launch && existsSync(gatewayPath())) throw new FocusDenied("stop the existing gateway with owner approval before issuing a new launch lease");
      const browserId = launch ? randomUUID() : readPrivateJson(gatewayPath()).browserId;
      const lease = grantArguments(args, browserId);
      console.log(`This permits desktop focus changes for ${Math.round((lease.expiresAt - lease.issuedAt) / 1000)}s. Pause other typing. Actions: ${lease.actions.join(",")}; targets: ${lease.targets.length}; launch: ${launch}.`);
      console.log("This does not authorize credentials, account mutations or uncertain retries.");
      const terminal = createInterface({input: process.stdin, output: process.stdout});
      try {
        if (await terminal.question('Type "allow foreground" to approve: ') !== "allow foreground") throw new FocusDenied("foreground approval not supplied");
      } finally { terminal.close(); }
      parseLease(lease, browserId);
      writePrivateJson(leasePath(), lease);
      console.log("Foreground lease granted. Never extend it automatically.");
    } else throw new Error("Use --help for owner-only foreground lease commands");
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
