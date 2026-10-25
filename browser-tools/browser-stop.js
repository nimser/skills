#!/usr/bin/env node

import {clearState, readState} from "./browser-config.js";

const state = readState();
if (!state) console.log("✓ No browser-tools browser is recorded for this instance");
else {
	clearState();
	console.log("✓ Detached; the recorded browser remains open. Closing a desktop browser requires separate owner approval.");
}
