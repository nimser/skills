#!/usr/bin/env node

import {readState} from "./browser-config.js";
import {windowRemaining} from "./focus/limits.js";

try {
  if (process.argv.length !== 3 || process.argv[2] !== "check") throw new Error("Usage: session-guard.js check. Request a window with browser-start.js --foreground.");
  const remaining = windowRemaining(readState()?.window);
  console.log(`OK — ${Math.floor(remaining / 1000)}s remaining in the confirmed browser window.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
