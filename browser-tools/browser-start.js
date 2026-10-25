#!/usr/bin/env node

import {connectBrowser, ensureOwnedPage, ownedPage, readOwnedTab, readState, runtimeDir, writeState} from "./browser-config.js";
import {requestHostResume} from "./focus/host.js";
import {modeEndpoint, startOptions} from "./focus/mode.js";
import {checkSessionBudget} from "./focus/client.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: browser-start.js [--host] [--resume] [--foreground [--direct-cdp] --seconds 1..300]\nDefault: attach for passive owned-tab inspection; never launch, navigate or activate.\n--foreground asserts explicit user approval for focus-changing work and, if needed, browser launch.\n--direct-cdp additionally approves browser-wide CDP/Puppeteer access; target isolation is not enforced in this mode.\nBoth elevated modes expire; never choose or renew them automatically.");
} else {
  try {
    const options = startOptions(args);
    const remaining = checkSessionBudget(runtimeDir());
    if (options.mode !== "background") {
      options.seconds = Math.min(options.seconds, Math.floor(remaining / 1000));
      if (options.seconds < 1) throw new Error("FOCUS_BLOCKED: session budget too short; no approval requested");
    }
    if (process.env.AGENT_HTTPS_PROXY) throw new Error("--host does not inherit container proxies");
    const previous = readState(), pin = readOwnedTab();
    if (previous && previous.mode !== "host") throw new Error("FOCUS_BLOCKED: legacy local state must be detached explicitly; no browser was stopped");
    const targets = pin && previous && pin.endpoint === previous.webSocketDebuggerUrl ? [pin.targetId] : [];
    const state = await requestHostResume(fetch, {...options, targets});
    writeState({...state, startedAt: new Date().toISOString()});
    const browser = await connectBrowser();
    try {
      if (options.mode !== "background") await ensureOwnedPage(browser);
      else if (pin) await ownedPage(browser);
    } finally { await browser.disconnect(); }
    console.log(`Connected in ${options.mode} mode${options.mode === "background" ? "; no browser launch, tab creation or activation requested" : ` for at most ${options.seconds}s; focus may change`}`);
    if (options.mode === "direct") console.log(JSON.stringify(modeEndpoint(state)));
  } catch (error) {
    console.error(`✗ ${error.message}. No automatic upgrade or retry was attempted.`);
    process.exitCode = 1;
  }
}
