---
name: browser-tools
description: Interactive browser automation via Chrome DevTools Protocol. Use when you need to interact with web pages, test frontends, or when user interaction with a visible browser is required.
---

# Browser Tools

Chrome DevTools Protocol tools for agent-assisted web automation. These tools connect to Chrome running on `:9222` with remote debugging enabled.

## Start Chrome

```bash
{baseDir}/browser-start.js              # Fresh profile
{baseDir}/browser-start.js --profile    # Copy user's profile (cookies, logins)
```

Launch Chrome with remote debugging on `:9222`. Use `--profile` to preserve user's authentication state.

**Note:** `browser-start.js` reuses an already-running instance on `:9222` if one exists (see "Check if already running" in the script). If you need to switch a running session onto/off the proxy, kill the existing Chrome process first (`pkill -f remote-debugging-port=9222` or similar) so it relaunches with the current `AGENT_HTTPS_PROXY` state.

## Proxy Support (optional)

Browsing can be routed through an HTTP(S) proxy via the `AGENT_HTTPS_PROXY` env var, set in your own environment however you manage secrets:

```bash
export AGENT_HTTPS_PROXY="https://user:pass@host:port"
```

This single var is the full proxy URL with inline credentials. When set:

- `browser-start.js` launches Chrome with `--proxy-server=<host:port>` (credentials stripped — Chrome's flag doesn't support inline auth).
- `browser-nav.js` and `browser-content.js` call `page.authenticate()` on every navigation to answer the proxy's 407 challenge automatically.
- No SOCKS5 needed — a plain HTTP/HTTPS proxy is sufficient for both Chrome and curl.
- The devcontainer's `--net=host` is unrelated to this — it just shares the host's network namespace; routing traffic through an upstream HTTP(S) proxy works the same as on the host, no extra container config required.

**Verify the proxy is actually live before relying on it** — don't assume traffic is flowing through it just because the env var is set:

```bash
{baseDir}/browser-proxy-check.js
```

This curls `https://api.ipify.org/` through `AGENT_HTTPS_PROXY`, prints the exit IP, fails if `AGENT_HTTPS_PROXY` is unset/invalid or the curl fails, and appends each check to a small history log (`../../artifacts/proxy-ip-history.log`, tab-separated `timestamp\tip`) for later reference. Run it once before a session that relies on the proxy — not just when things seem broken.

If Chrome was started without `AGENT_HTTPS_PROXY` set (or the var changed since), restart it (see note above) before navigating — the proxy flag is baked in at process launch.

## Proxied Session Bootstrap (logged-in sites)

For any logged-in workflow that must go through the residential proxy (account-bound dashboards, social sites), use the one-shot bootstrap instead of wiring the steps by hand:

```bash
{baseDir}/browser-session-start.sh --url <URL> [--proxy-gopass <path>] [--minutes N] [--no-proxy]
```

It sets `AGENT_HTTPS_PROXY` fresh from gopass (default: dataimpulse **sticky** residential — stable exit IP per session, better for logged-in sites), verifies it via `browser-proxy-check.js` (logs the exit IP), restarts Chrome so the proxy flag binds, relaunches with `--profile` (logins persist), navigates to `--url`, and starts a wall-clock guard (`session-guard.js`, default 25 min). **Login is always manual** — it never fills credentials. Report the exit IP to the user, then check for a login form.

Site skills wrap this. Before every browser-tools action in such a session, run `{baseDir}/session-guard.js check`; run `stop` at the end.

## Navigate

```bash
{baseDir}/browser-nav.js https://example.com
{baseDir}/browser-nav.js https://example.com --new
```

Navigate to URLs. Use `--new` flag to open in a new tab instead of reusing current tab.

## Evaluate JavaScript

```bash
{baseDir}/browser-eval.js 'document.title'
{baseDir}/browser-eval.js 'document.querySelectorAll("a").length'
```

Execute JavaScript in the active tab. Code runs in async context. Use this to extract data, inspect page state, or perform DOM operations programmatically.

## Screenshot

```bash
{baseDir}/browser-screenshot.js
```

Capture current viewport and return temporary file path. Use this to visually inspect page state or verify UI changes.

## Pick Elements

```bash
{baseDir}/browser-pick.js "Click the submit button"
```

**IMPORTANT**: Use this tool when the user wants to select specific DOM elements on the page. This launches an interactive picker that lets the user click elements to select them. The user can select multiple elements (Cmd/Ctrl+Click) and press Enter when done. The tool returns CSS selectors for the selected elements.

Common use cases:

- User says "I want to click that button" → Use this tool to let them select it
- User says "extract data from these items" → Use this tool to let them select the elements
- When you need specific selectors but the page structure is complex or ambiguous

## Cookies

```bash
{baseDir}/browser-cookies.js
```

Display all cookies for the current tab including domain, path, httpOnly, and secure flags. Use this to debug authentication issues or inspect session state.

## Extract Page Content

```bash
{baseDir}/browser-content.js https://example.com
```

Navigate to a URL and extract readable content as markdown. Uses Mozilla Readability for article extraction and Turndown for HTML-to-markdown conversion. Works on pages with JavaScript content (waits for page to load).

## When to Use

- Testing frontend code in a real browser
- Interacting with pages that require JavaScript
- When user needs to visually see or interact with a page
- Debugging authentication or session issues
- Scraping dynamic content that requires JS execution

---

## Efficiency Guide

### DOM Inspection Over Screenshots

**Don't** take screenshots to see page state. **Do** parse the DOM directly:

```javascript
// Get page structure
document.body.innerHTML.slice(0, 5000)

// Find interactive elements
Array.from(document.querySelectorAll('button, input, [role="button"]')).map(e => ({
  id: e.id,
  text: e.textContent.trim(),
  class: e.className
}))
```

### Complex Scripts in Single Calls

Wrap everything in an IIFE to run multi-statement code:

```javascript
(function() {
  // Multiple operations
  const data = document.querySelector('#target').textContent;
  const buttons = document.querySelectorAll('button');
  
  // Interactions
  buttons[0].click();
  
  // Return results
  return JSON.stringify({ data, buttonCount: buttons.length });
})()
```

### Batch Interactions

**Don't** make separate calls for each click. **Do** batch them:

```javascript
(function() {
  const actions = ["btn1", "btn2", "btn3"];
  actions.forEach(id => document.getElementById(id).click());
  return "Done";
})()
```

### Typing/Input Sequences

```javascript
(function() {
  const text = "HELLO";
  for (const char of text) {
    document.getElementById("key-" + char).click();
  }
  document.getElementById("submit").click();
  return "Submitted: " + text;
})()
```

### Reading App/Game State

Extract structured state in one call:

```javascript
(function() {
  const state = {
    score: document.querySelector('.score')?.textContent,
    status: document.querySelector('.status')?.className,
    items: Array.from(document.querySelectorAll('.item')).map(el => ({
      text: el.textContent,
      active: el.classList.contains('active')
    }))
  };
  return JSON.stringify(state, null, 2);
})()
```

### Structured DOM Mapping (For Recurring Workflows)

When interacting with complex or recurring applications (like Single Page Applications, nested forms, or accordions), **don't guess selectors on every run**. Instead, create and use a static mapping file.

1. **Check for existing maps first:**
   Before running exploratory DOM scripts, look for `.agents/artifacts/browser-mappings.json`.
   If it exists, read it and check if the current URL (domain or path) matches any top-level key to find the appropriate exact CSS selectors.

2. **Create a map if missing:**
   If the user asks you to interact with a new complex workflow, write a script to explore the DOM (expanding accordions, opening modals sequentially), extract labels/IDs, and append the JSON schema to `.agents/artifacts/browser-mappings.json` using the domain or URL pattern as the top-level key.

3. **Self-Healing:**
   Websites change. If a selector from the mapping file fails (element not found), assume the UI was updated. Re-run an exploratory script to find the new selectors and update the JSON mapping file automatically.

### Waiting for Updates

If DOM updates after actions, add a small delay with bash:

```bash
sleep 0.5 && {baseDir}/browser-eval.js '...'
```

### Investigate Before Interacting

Always start by understanding the page structure:

```javascript
(function() {
  return {
    title: document.title,
    forms: document.forms.length,
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input').length,
    mainContent: document.body.innerHTML.slice(0, 3000)
  };
})()
```

Then target specific elements based on what you find.
