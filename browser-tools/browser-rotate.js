#!/usr/bin/env node

import {readState} from "./browser-config.js";
import {requestProxyRotation} from "./focus/host.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: browser-rotate.js --confirm-idle\nAsserts explicit user approval to stop all Automation tabs/tasks before an account change.\nStops only the pinned proxy browser and its relay; preserves cookies and task timers.\nThen request a separately approved browser-start.js --foreground launch and verify browser/relay exits changed.\nNo launch, foreground grant, task-budget renewal, network switch or automatic retry is performed.\nExisting time-exception receipts cannot follow the replacement browser generation.");
} else {
  try {
    if (args.length !== 1 || args[0] !== "--confirm-idle") throw new Error("Explicit approval required: browser-rotate.js --confirm-idle");
    await requestProxyRotation(readState(), true);
    console.log("Automation proxy browser and relay stopped; cookies and task timers preserved. A separately approved foreground launch selects the next sticky upstream port. Verify changed browser/relay exits before login; old generation-bound exception receipts are invalid. No automatic relaunch was attempted.");
  } catch (error) {
    console.error(`✗ ${error.message}. No automatic retry was attempted.`);
    process.exitCode = 1;
  }
}
