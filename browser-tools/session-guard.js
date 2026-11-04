#!/usr/bin/env node
// Record one bounded task timer; host-issued exceptions use their absolute expiry.
import fs from "node:fs";
import {runtimeDir, readState} from "./browser-config.js";
import {checkSessionBudget} from "./focus/client.js";
import {TASK_MINUTES} from "./focus/limits.js";

const stateFile = process.env.BROWSER_SESSION_GUARD_STATE || `${runtimeDir()}/session-guard.state`;
const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "start" && args.length <= 1) {
    const minutes = args.length ? Number(args[0]) : TASK_MINUTES;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > TASK_MINUTES) throw new Error(`Task budget must be 1..${TASK_MINUTES} minutes; extensions require a third-party host agent`);
    fs.mkdirSync(runtimeDir(), {recursive: true, mode: 0o700});
    fs.writeFileSync(stateFile, `${Date.now()}\t${minutes}`, {flag: "wx", mode: 0o600});
    console.log(`Session timer started. Hard budget: ${minutes} minutes.`);
  } else if (cmd === "check" && !args.length) {
    const timeException = readState()?.timeException;
    if (!timeException && !fs.existsSync(stateFile)) throw new Error('No active session; run "start" once for an approved task');
    const remaining = checkSessionBudget(runtimeDir(), timeException);
    console.log(`OK — ${Math.floor(remaining / 1000)}s remaining${timeException ? " under a third-party host exception" : " in this task"}.`);
  } else if (cmd === "stop" && !args.length) {
    fs.rmSync(stateFile, {force: true});
    console.log("Session timer cleared; an existing host exception must be revoked separately.");
  } else throw new Error("Usage: node session-guard.js start [minutes] | check | stop");
} catch (error) {
  console.error(error.code === "EEXIST" ? "A task timer is already recorded; never restart it to extend a task. Request a third-party host exception." : error.message);
  process.exitCode = 1;
}
