#!/usr/bin/env node

import {connectBrowser, ownedPage} from "./browser-config.js";

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("--")) throw new Error("Usage: browser-inspect.js [CSS_SELECTOR]");
const browser = await connectBrowser();
try {
  const page = await ownedPage(browser), cdp = await page.createCDPSession();
  try {
    const {root} = await cdp.send("DOM.getDocument", {depth: 0});
    const {nodeIds} = await cdp.send("DOM.querySelectorAll", {nodeId: root.nodeId, selector: args[0] || "input,textarea,select,button,[role]"});
    const elements = [];
    for (const nodeId of nodeIds.slice(0, 100)) {
      const {node} = await cdp.send("DOM.describeNode", {nodeId, depth: 0});
      const attributes = {};
      for (let index = 0; index < (node.attributes || []).length; index += 2) {
        const key = node.attributes[index];
        if (["id", "class", "role", "type", "disabled", "readonly", "aria-disabled"].includes(key)) attributes[key] = node.attributes[index + 1];
      }
      elements.push({tag: node.localName, attributes});
    }
    console.log(JSON.stringify({matches: nodeIds.length, truncated: nodeIds.length > 100, elements}, null, 2));
  } finally { await cdp.detach(); }
} finally { await browser.disconnect(); }
