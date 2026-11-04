#!/usr/bin/env node

import fs from "node:fs";
import {connectBrowser, ensureOwnedPage, ownedPage, readOwnedTab, readState, runtimeDir, writeState} from "./browser-config.js";
import {requestHostResume, resumeException} from "./focus/host.js";
import {modeEndpoint, startOptions} from "./focus/mode.js";
import {checkSessionBudget} from "./focus/client.js";
import {exceptionRemaining} from "./focus/limits.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: browser-start.js [--host] [--resume] [--network=proxy|direct] [--foreground [--direct-cdp] --seconds 1..900 | --exception FILE]\nDefault: attach for passive owned-tab inspection; never launch, navigate or activate.\n--foreground asserts explicit user approval for focus-changing work and, if needed, browser launch.\n--direct-cdp additionally approves browser-wide CDP/Puppeteer access; target isolation is not enforced in this mode.\nNetwork defaults to proxy. --network=direct asserts explicit approval to bypass the proxy for every Automation tab; this is independent of --direct-cdp.\nThe network choice is fixed for the browser lifetime; incompatible attachments are refused without restart or fallback.\nBoth elevated modes expire; never choose or renew them automatically.");
} else {
  try {
    const options = startOptions(args);
    let receipt;
    if (options.exceptionFile) {
      const fd = fs.openSync(options.exceptionFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 16_384) throw new Error("FOCUS_BLOCKED: unsafe time-exception receipt");
        try { receipt = JSON.parse(fs.readFileSync(fd, "utf8")); }
        catch { throw new Error("FOCUS_BLOCKED: invalid time-exception receipt JSON"); }
      } finally { fs.closeSync(fd); }
      if (!receipt || !receipt.timeException || receipt.interactionMode !== options.mode) throw new Error("FOCUS_BLOCKED: receipt mode must match explicit foreground/direct selection");
      exceptionRemaining(receipt.timeException);
    }
    const remaining = checkSessionBudget(runtimeDir(), receipt?.timeException);
    if (options.mode !== "background") {
      options.seconds = receipt ? Math.floor(remaining / 1000) : Math.min(options.seconds, Math.floor(remaining / 1000));
      if (options.seconds < 1) throw new Error("FOCUS_BLOCKED: session budget too short; no approval requested");
    }
    if (process.env.AGENT_HTTPS_PROXY) throw new Error("--host does not inherit container proxies");
    const previous = readState(), pin = readOwnedTab();
    if (previous && previous.mode !== "host") throw new Error("FOCUS_BLOCKED: legacy local state must be detached explicitly; no browser was stopped");
    const targets = pin && previous && pin.endpoint === previous.webSocketDebuggerUrl ? [pin.targetId] : [];
    const state = receipt ? await resumeException(receipt, options.networkMode) : await requestHostResume(fetch, {...options, targets});
    writeState({...state, startedAt: new Date().toISOString()});
    const browser = await connectBrowser();
    try {
      if (options.mode !== "background") await ensureOwnedPage(browser);
      else if (pin) await ownedPage(browser);
    } finally { await browser.disconnect(); }
    console.log(`Connected in ${options.mode} mode; network=${state.networkMode}${options.mode === "background" ? "; no browser launch, tab creation or activation requested" : ` for at most ${options.seconds}s; focus may change`}`);
    if (options.mode === "direct") console.log(JSON.stringify(modeEndpoint(state)));
  } catch (error) {
    console.error(`✗ ${error.message}. No automatic upgrade or retry was attempted.`);
    process.exitCode = 1;
  }
}
