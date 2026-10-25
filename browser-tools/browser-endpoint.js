#!/usr/bin/env node

import {connectBrowser, readState} from "./browser-config.js";
import {modeEndpoint} from "./focus/mode.js";

if (process.argv.slice(2).join(" ") !== "--direct-cdp") throw new Error("Usage: browser-endpoint.js --direct-cdp; explicitly request browser-start.js --foreground --direct-cdp first");
const state = readState();
if (state?.interactionMode !== "direct") throw new Error("FOCUS_BLOCKED: this instance has no explicitly selected direct-CDP mode");
const browser = await connectBrowser();
await browser.disconnect();
console.log(JSON.stringify(modeEndpoint(state)));
