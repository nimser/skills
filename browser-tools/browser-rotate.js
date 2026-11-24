#!/usr/bin/env node

import {readState} from "./browser-config.js";
import {requestProxyRotation} from "./focus/host.js";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: browser-rotate.js --confirm-idle\nAsserts explicit user approval to stop all Automation tabs/tasks before an account change.\nStops only the pinned proxy browser and its relay, preserving cookies.\nConfirm the next browser-start.js --foreground launch on the host desktop and verify browser/relay exits changed.\nDoes not launch, grant or renew a window, switch networks or retry.\nWindows from earlier browser generations cannot be reused.");
} else {
  try {
    if (args.length !== 1 || args[0] !== "--confirm-idle") throw new Error("Explicit approval required: browser-rotate.js --confirm-idle");
    await requestProxyRotation(readState(), true);
    console.log("Automation proxy browser and relay stopped. Cookies were preserved. A fresh confirmed launch selects the next sticky upstream port. Verify changed browser/relay exits before login. No automatic relaunch was attempted.");
  } catch (error) {
    console.error(`✗ ${error.message}. No automatic retry was attempted.`);
    process.exitCode = 1;
  }
}
