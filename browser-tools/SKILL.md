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

**Note:** reuses a running `:9222` instance if one exists. To change proxy state, kill it first (`pkill -f remote-debugging-port=9222`) so it relaunches with the current `AGENT_HTTPS_PROXY`.

## Proxy Support (optional)

`AGENT_HTTPS_PROXY` holds a full proxy URL with inline credentials. **Never print, echo, or log its value.** Build it with a proxy-URL builder command (`AGENT_PROXY_URL_CMD`, default `dataimpulse-proxy-url` — a private dotfiles script, **not shipped with this skill**; see `{baseDir}/PROXY.md` for the contract and a reference implementation) and capture via command substitution only:

```bash
export AGENT_HTTPS_PROXY="$(dataimpulse-proxy-url --print --countries fr)"  # sticky FR exit, 60min rotation
dataimpulse-proxy-url --help   # --rotating, --session-id, --ttl, --state, --city, --list-countries, --entry
```

Default (no `--countries`) uses the provider's dashboard-default country. `--rotating` (new IP per request) is for stateless scraping only — never for logged-in sessions. Report only host/port/countries and the exit IP to the user; run `gopass show` only captured into a variable, never bare.

Env vars do **not** persist across separate bash tool calls: export and use `AGENT_HTTPS_PROXY` in the *same* call as `browser-start.js`/`browser-nav.js`/`browser-content.js`, otherwise Chrome silently launches without the proxy.

When set: `browser-start.js` passes `--proxy-server=<host:port>` (credentials stripped — Chrome's flag has no inline auth); `browser-nav.js`/`browser-content.js` call `page.authenticate()` per navigation to answer the 407 challenge. Plain HTTP(S) suffices; no SOCKS5. The flag binds at launch, so restart Chrome after setting/changing the var.

Verify it's live before relying on it:

```bash
{baseDir}/browser-proxy-check.js
```

Curls `https://api.ipify.org/` through the proxy, prints the exit IP, fails if the var is unset/invalid or curl fails, and appends `timestamp\tip` to `../../artifacts/proxy-ip-history.log`.

## Proxied Session Bootstrap (logged-in sites)

For logged-in workflows through the residential proxy (account-bound dashboards, social sites), use the one-shot bootstrap:

```bash
{baseDir}/browser-session-start.sh --url <URL> [--countries cc[,cc..]] [--rotating] [--session-id X] [--ttl N] [--minutes N] [--no-proxy]
```

It sets `AGENT_HTTPS_PROXY` fresh via `dataimpulse-proxy-url` (gopass-backed; proxy flags passed through — default: sticky residential, 60-min rotation interval, dashboard-default country), verifies via `browser-proxy-check.js`, restarts Chrome so the flag binds, relaunches with `--profile` (logins persist), navigates to `--url`, and starts a guard (`session-guard.js`, default 25 min). **Login is always manual.** Report the exit IP, then check for a login form.

Site-specific skills can wrap this and pass their own targeting (e.g. `--countries fr`). Run `{baseDir}/session-guard.js stop` at the end of the session.

## Session Guard (automatic)

The pre-flight is not typed by hand. The `browser-guard` pi extension
(`/workspaces/metagrowth/extensions/browser-guard.ts`, loaded with
`pi -e /workspaces/metagrowth/extensions/browser-guard.ts`) intercepts any bash
command that runs `browser-nav.js`, `browser-eval.js`, `browser-content.js`,
`browser-screenshot.js`, `browser-click-xy.js`, `browser-cookies.js`,
`browser-pick.js` or `browser-hn-scraper.js` and, before it executes:

- runs the wall-clock guard (`session-guard.js`, resolved next to the script)
  — an **EXPIRED** session blocks the action, and the block names the recovery
  command;
- polls `http://127.0.0.1:9222/json/version` — a dead browser blocks the action
  instead of a connection-refused stack trace. This readiness poll replaces the
  `sleep 2 && ...` padding after a navigation or a Chrome restart.

A session with no timer is not blocked: the timer is opt-in and belongs to
proxied, logged-in sessions (`browser-session-start.sh` starts it). `--help`
invocations pass through.

Env knobs: `BROWSER_GUARD_CDP_URL` (default `http://127.0.0.1:9222`),
`BROWSER_GUARD_WAIT_MS` (default 3000), `BROWSER_GUARD_SKILL_DIR` (fallback dir
holding `session-guard.js`), `BROWSER_GUARD_REQUIRE_SESSION=1` (also block when
no timer was ever started), `BROWSER_GUARD_DISABLE=1` (pass everything through).

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
