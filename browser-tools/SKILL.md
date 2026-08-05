---
name: browser-tools
description: Interactive browser automation via Chrome DevTools Protocol. Use when you need to interact with web pages, test frontends, or when user interaction with a visible browser is required.
---

# Browser Tools

Chrome DevTools Protocol tools for agent-assisted browser automation. The skill
starts Chrome with remote debugging on an available local port and records that
endpoint in a container-local runtime directory.

## Start Chrome

```bash
{baseDir}/browser-start.js              # Fresh container-local profile
{baseDir}/browser-start.js --profile    # Keep this container's login state
```

The default profile lives below the container's temporary directory, not a
shared home directory or volume. The runtime directory includes `PI_SESSION_ID`
when available; set `BROWSER_TOOLS_INSTANCE` to choose a stable instance name.
The selected CDP endpoint is written to `state.json` beside the profile.

Startup checks from `BROWSER_CDP_PORT` (or `9222`) upward and selects the first
available port. If a browser recorded in the local state is alive, it is reused;
an unrelated browser is never attached to or killed.

Optional environment variables:

- `BROWSER_TOOLS_RUNTIME_DIR` — override the container-local runtime directory.
- `BROWSER_USER_DATA_DIR` — override the profile directory; use only a path local to this container.
- `BROWSER_TOOLS_INSTANCE` — isolate multiple browser sessions in one container.
- `BROWSER_CDP_PORT` — starting/helper port; startup increments when occupied.
- `BROWSER_CDP_URL` — explicit helper endpoint, overriding local state.

## Proxy Support (optional)

`AGENT_HTTPS_PROXY` holds a proxy URL. **Never print, echo, or log its value.**
Provide it through a local secret-aware command selected with
`AGENT_PROXY_URL_CMD`; the command is intentionally outside this public skill:

```bash
export AGENT_HTTPS_PROXY="$("${AGENT_PROXY_URL_CMD:?set AGENT_PROXY_URL_CMD}" --print)"
```

Use a stable proxy endpoint for logged-in sessions. Environment variables do
not persist across separate shell calls, so export `AGENT_HTTPS_PROXY` in the
same call as the browser command or use `browser-session-start.sh`.

When set, `browser-start.js` passes the proxy host and port to Chrome without
inline credentials; navigation helpers answer proxy-auth challenges per page.
The proxy flag binds at launch, so restart Chrome after changing the variable.

Verify it before relying on it:

```bash
{baseDir}/browser-proxy-check.js
```

The check routes a connectivity request through the proxy and reports only its
exit address.

## Proxied Session Bootstrap (logged-in sites)

For a logged-in workflow, use the one-shot bootstrap:

```bash
{baseDir}/browser-session-start.sh --url <URL> [--minutes N] [--no-proxy]
```

It obtains `AGENT_HTTPS_PROXY` through the locally configured proxy builder,
verifies it, stops only the browser recorded in this container's local state,
starts Chrome on an available port so the proxy flag binds, navigates to the
target URL, and starts a wall-clock session guard. **Login is always manual.**

Site-specific skills may wrap this script and pass targeting flags accepted by
their local proxy builder. Common defaults can be set without a wrapper:

```bash
export AGENT_PROXY_COUNTRIES="fr,de"
export AGENT_PROXY_TTL=60
export AGENT_PROXY_ROTATING=false
```

Command-line flags override these defaults. Run `{baseDir}/session-guard.js stop`
at the end of the session.

## Session Guard (automatic)

The `browser-guard` extension intercepts bash commands that run browser helpers
and, before they execute:

- runs the wall-clock guard (`session-guard.js`, resolved next to the script);
- polls the CDP endpoint recorded in the container-local browser state — a dead
  or unrecorded browser blocks the action instead of producing a connection
  error. This replaces `sleep 2 &&` padding after navigation or a restart.

A session with no timer is not blocked: the timer is opt-in for logged-in
sessions. `--help` invocations pass through.

Environment knobs:

- `BROWSER_GUARD_CDP_URL` — explicit CDP endpoint;
- `BROWSER_GUARD_WAIT_MS` — readiness wait, default 3000;
- `BROWSER_GUARD_SKILL_DIR` — directory containing `session-guard.js`;
- `BROWSER_GUARD_REQUIRE_SESSION=1` — also block when no timer was started;
- `BROWSER_GUARD_DISABLE=1` — disable the preflight.

The guard otherwise reads `BROWSER_CDP_URL`, `BROWSER_CDP_PORT`, or the local
state written by `browser-start.js`.

## Navigate

```bash
{baseDir}/browser-nav.js https://example.com
{baseDir}/browser-nav.js https://example.com --new
```

Navigate to URLs. Use `--new` to open a new tab instead of reusing the current
one.

## Evaluate JavaScript

```bash
{baseDir}/browser-eval.js 'document.title'
{baseDir}/browser-eval.js 'document.querySelectorAll("a").length'
```

Execute JavaScript in the active tab. Code runs in async context.

## Screenshot

```bash
{baseDir}/browser-screenshot.js
```

Capture the current viewport and return a temporary file path.

## Pick Elements

```bash
{baseDir}/browser-pick.js "Click the submit button"
```

Use this when a user wants to select DOM elements. The picker supports multiple
selections with Cmd/Ctrl-click and finishes with Enter.

## Cookies

```bash
{baseDir}/browser-cookies.js
```

Display cookies for the current tab, including domain, path, and security flags.

## Extract Page Content

```bash
{baseDir}/browser-content.js https://example.com
```

Navigate to a URL and extract readable content as Markdown.

## When to Use

- Testing a frontend in a real browser.
- Interacting with a page that requires JavaScript.
- When a user needs to see or interact with a visible browser.
- Debugging authentication or session issues.
- Scraping dynamic content that requires JavaScript.

---

## Efficiency Guide

### DOM Inspection Over Screenshots

Prefer DOM parsing over screenshots when inspecting page state:

```javascript
document.body.innerHTML.slice(0, 5000)
```

Inspect interactive elements directly:

```javascript
Array.from(document.querySelectorAll('button, input, [role="button"]')).map(e => ({
  id: e.id,
  text: e.textContent.trim(),
  class: e.className
}))
```

### Complex Scripts in Single Calls

Wrap multi-statement evaluation in an IIFE:

```javascript
(function() {
  const data = document.querySelector('#target')?.textContent;
  const buttons = document.querySelectorAll('button');
  return JSON.stringify({ data, buttonCount: buttons.length });
})()
```

### Batch Interactions

Batch independent actions in one browser evaluation rather than making a call
for each element.

### Waiting for Updates

If the DOM updates after an action, wait briefly before reading it again:

```bash
sleep 0.5 && {baseDir}/browser-eval.js 'document.body.innerText'
```

### Investigate Before Interacting

Start by understanding the page structure:

```javascript
(function() {
  return {
    title: document.title,
    forms: document.forms.length,
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input').length,
    mainContent: document.body.innerHTML.slice(0, 3000)
  }
})()
```

Then target selectors based on what you found.
