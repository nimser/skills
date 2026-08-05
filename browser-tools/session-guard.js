#!/usr/bin/env node
// Wall-clock guard for proxied browser-tools sessions (logged-in site
// workflows). Enforces a hard time budget so a stuck/failing agent can't
// keep hammering a logged-in site while the user is AFK — that's exactly what
// gets an account flagged or an IP banned.
//
// Budget is configurable per session (minutes), default 25.
//
// The `check` sub-command is not typed by hand: the browser-guard pi extension
// (~/.pi/agent/extensions/browser-guard.ts) runs it automatically before every
// browser-*.js command and blocks the action when the budget is spent.
//
// Usage:
//   node session-guard.js start [minutes]   # begin timing; call once at session start
//   node session-guard.js check             # automatic (browser-guard); exits 1 + prints "EXPIRED" past budget
//   node session-guard.js stop              # clean up at the end of a session (success or abort)
//
// State file lives in the container-local browser runtime directory.
import fs from "node:fs";
import { runtimeDir } from "./browser-config.js";

const DEFAULT_BUDGET_MIN = 25;
const stateFile = process.env.BROWSER_SESSION_GUARD_STATE || `${runtimeDir()}/session-guard.state`;
const cmd = process.argv[2];

function readState() {
  const [started, budgetMin] = fs.readFileSync(stateFile, "utf8").split("\t");
  return { started: Number(started), budgetMs: Number(budgetMin) * 60 * 1000, budgetMin: Number(budgetMin) };
}

if (cmd === "start") {
  const budgetMin = Number(process.argv[3]) || DEFAULT_BUDGET_MIN;
  fs.mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateFile, `${Date.now()}\t${budgetMin}`);
  console.log(`Session timer started. Hard budget: ${budgetMin} minutes. browser-guard checks it before every browser-tools action.`);
} else if (cmd === "check") {
  if (!fs.existsSync(stateFile)) {
    console.error(`No active session (run "start" first). Refusing to proceed without a timer.`);
    process.exit(1);
  }
  const { started, budgetMs, budgetMin } = readState();
  const elapsed = Date.now() - started;
  const remaining = budgetMs - elapsed;
  if (remaining <= 0) {
    console.error(
      `EXPIRED — session has run ${(elapsed / 60000).toFixed(1)} min, budget is ${budgetMin} min.\n` +
      `STOP all browser-tools actions now. Do not retry. Report status to the user: what was ` +
      `completed vs. still pending, and why the session ran long (stuck selector, unexpected page, etc.). ` +
      `A fresh session needs fresh explicit approval (and a fresh proxy check).`
    );
    process.exit(1);
  }
  console.log(`OK — ${(remaining / 1000).toFixed(0)}s remaining in this ${budgetMin}-minute session.`);
} else if (cmd === "stop") {
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  console.log("Session timer cleared.");
} else {
  console.error("Usage: node session-guard.js start [minutes] | check | stop");
  process.exit(1);
}
