#!/usr/bin/env node

import {connectBrowser, ensureOwnedPage, ownedPage, readOwnedTab, readState, writeState} from "./browser-config.js";
import {requestHostResume} from "./focus/host.js";
import {startOptions} from "./focus/mode.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: browser-start.js [--resume] [--network=proxy|direct] [--foreground [--direct-cdp] [--seconds N]]\nDefault: attach for passive owned-tab inspection.\n--foreground requests a human confirmation on the Automation host. Default: 900 seconds.\n--direct-cdp requests browser-wide access without tab isolation.\nNetwork defaults to proxy and cannot change without stopping the browser.");
} else {
  try {
    const options = startOptions(args);
    if (process.env.AGENT_HTTPS_PROXY) throw new Error("--host does not inherit container proxies");
    const previous = readState(), pin = readOwnedTab();
    if (previous && previous.mode !== "host") throw new Error("FOCUS_BLOCKED: legacy local state must be detached explicitly; no browser was stopped");
    const samePin = pin && previous && pin.endpoint === previous.webSocketDebuggerUrl;
    const state = await requestHostResume(fetch, {...options, targets: samePin ? [pin.targetId] : [], pinnedBrowserId: samePin ? previous.browserId : undefined});
    writeState({...state, startedAt: new Date().toISOString()});
    const browser = await connectBrowser();
    try {
      if (options.mode !== "background") await ensureOwnedPage(browser);
      else if (pin) await ownedPage(browser);
    } finally { await browser.disconnect(); }
    console.log(`Connected in ${options.mode} mode; network=${state.networkMode}${state.window ? `; window expires ${new Date(state.window.expiresAt).toISOString()}; focus may change` : "; no browser launch, tab creation or activation requested"}`);
  } catch (error) {
    console.error(`✗ ${error.message}. No automatic upgrade or retry was attempted.`);
    process.exitCode = 1;
  }
}
