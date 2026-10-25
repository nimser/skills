---
name: browser-tools
description: Guarded, owned-tab browser automation with explicit foreground leases, page mappings and bounded sequential helpers.
---

# Browser tools

## Focus safety

**Use application APIs/CLI while the owner works in another application.** No
background browser action class has an approved focus-neutral capability.
Navigation/reload, blank-tab creation, DOM clicks, coordinate/CDP input,
screenshots, evaluation and reconnects fail closed without an explicit foreground
window. Do not activate a window/tab, restore focus afterward, inject global input,
retry with another driver or use browser interaction as an API failure fallback.

Autosaving editors are persistent mutations: redirected physical typing can alter
source even when the agent never intended to type. Owned targets, `background:
true`, `document.hasFocus()` and Niri's `open-focused false` are not proof of
end-to-end desktop safety. A DOM click can execute focus-changing site code.

The shared [focus gateway](focus/README.md) owns the browser's private CDP pipe.
Its loopback WebSocket is the only supported protocol endpoint. Policy is checked
before every CDP command, including direct helpers, not just before a CLI starts.
Legacy/raw endpoints, container-local launch, automatic session/data resets and
unreviewed protocol methods are unsupported. Static host policy is checked before
requesting a start/resume; the live gateway identity is checked before opening a
protocol socket. Saved markers alone do not verify an endpoint. There is no
raw-CDP fallback.

## Foreground approval

Ask for a bounded foreground window only when API/CLI cannot do the work. Name
the profile, owned target, actions and duration; explain that focus can change and
the owner must pause other typing. This is separate from approval of account
mutations, publishing, sending, deletion and payloads. Login, consent and security
keys remain manual. Stop on CAPTCHA, access denial, throttling or suspicious
activity; never route around an authentication wall.

The owner issues leases from an interactive **host terminal**, following
[the runtime guide](focus/README.md). Agents must not issue, extend or emulate the
confirmation, allocate a PTY to grant a lease, or modify approval files. A lease
lasts at most five minutes and is bound to one gateway/browser generation, explicit
CDP action classes and targets. Newly created owned tabs inherit only that lease;
popups, workers, unrelated targets and browser restarts do not. A new lease needs
explicit target approval. Revocation/expiry blocks subsequent sends, including
through a previously opened CDP session. Already-sent work is not cancelled:
timeouts, disconnections and expiry can leave an uncertain mutation; stop and
hand back instead of replaying it or assuming failure.

## Host runtime

Host setup/recovery: `~/.local/lib/browser-tools-host/README.md`. Preserve the
**Automation** profile, Firejail, bubblewrap, native security-key access, browser
sandbox and visible GPU rendering. The Niri unfocused-open rule remains a useful
extra, not the enforcement boundary. Host-network containers share the named
browser and loopback gateway; use trusted agents and separate daily accounts.
No new USB mounts or sandbox/GPU-disable flags are permitted.

After approved deployment and an owner-issued lease:

```sh
node {baseDir}/session-guard.js start 20  # once for an approved logged-in session
{baseDir}/browser-start.js --host --resume
{baseDir}/browser-nav.js https://example.test --no-login-wait
{baseDir}/browser-stop.js               # detach only; never close shared tabs
```

Each instance pins the gateway identity and its owned tab in `owned-tab.json`.
Helpers never choose the selected, last or newest foreign tab. Closed/mismatched
owned tabs fail; replacement requires explicit `browser-nav.js URL --new` and a
`tab-create` lease capability. `browser-start.js --host --resume` does not replace
a closed/mismatched owned target automatically. Browser restart invalidates the
lease and pin. Manual target/window selection is never automated.

Runtime configuration:

- `BROWSER_TOOLS_RUNTIME_DIR`: instance-local state directory.
- `BROWSER_TOOLS_INSTANCE` or `PI_SESSION_ID`: default runtime instance name.
- `BROWSER_TOOLS_STATE`: explicit instance state file.
- `BROWSER_TOOLS_FOCUS_RUNTIME_DIR`: host gateway/approval directory; do not share
  it with untrusted processes or override it to evade the host policy.
- `BROWSER_GUARD_REQUIRE_SESSION=1`: also require a timer for non-logged-in work.

The recorded endpoint wins over environment port/URL values. Endpoint environment
variables and `BROWSER_GUARD_DISABLE` cannot grant focus capabilities. The optional
Pi `browser-guard` preflight checks readiness/time budgets; it is not the focus
boundary. An expired or malformed recorded timer blocks each shared-client send.
Never restart a timer to extend an expired session automatically. Stop it with
`node {baseDir}/session-guard.js stop` when the approved session ends.

## Helpers and capabilities

| Helper | Foreground capabilities |
| --- | --- |
| `browser-nav.js URL [--new] [--reload] [--no-login-wait]` | `navigate`; `tab-create` for `--new`; `javascript` for login detection |
| `browser-eval.js 'expression'` | `javascript` |
| `browser-click-xy.js X Y` | `pointer` |
| `browser-screenshot.js` | `screenshot` |
| `browser-content.js URL` | `navigate`, `inspect`, `javascript` |
| `browser-login-wait.js [--seconds N]` | `javascript`; never enters credentials |
| `browser-pick.js 'message'` | `javascript`; owner selects elements manually |
| mapping `check` | `javascript` and the session timer |

These are dispatch scopes, not semantic mutation authorization or proof of
neutrality. `javascript` permits arbitrary page code, including site callbacks,
focus requests, timers and popups; it is never treated as a read-only escape.
Coordinate input can trigger any site action. Prefer narrow structural reads over
screenshots or HTML dumps; never extract unrelated private fields or editor
contents. `browser-cookies.js`, proxy-auth browser sessions and the automatic
`browser-session-start.sh` bootstrap are unsupported and fail closed.

## Direct helpers

Read [BROWSER-MAPPINGS.md](BROWSER-MAPPINGS.md) for persistent inventories and paced
scripts. Project workflows/mappings stay in their own repository; shared policy
stays in this skill. Use the shared client, not Puppeteer/Playwright attachment:

```javascript
import { connectBrowser, ownedPage } from "/usr/local/share/agent-skills/browser-tools/browser-config.js";

const browser = await connectBrowser();
try {
  const page = await ownedPage(browser);
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: [] });
  } finally {
    await cdp.detach();
  }
} finally {
  await browser.disconnect();
}
```

This requires an `inspect` foreground lease. Raw WebSocket commands sent to the
same gateway receive the same policy checks. Raw browser ports, profile endpoint
files, nested protocol tunnels, browser-global commands, automatic attachment
that pauses foreign pages, and activation APIs are not supported. The small
shared page client intentionally does not implement the full Puppeteer API.
Unsupported operations stop; they do not trigger alternate attachment.

## Measured interaction and tests

Inspect the intended state before acting; check authorization and preconditions
for each dependent mutation, then verify the persisted result. No automatic
mutation retries, parallel writes or mass submissions. Agent tool calls need no
artificial sleeps. Reusable scripts use bounded condition waits and sequential
300–800 ms pacing; pauses are not a readiness, anti-bot or focus guarantee.

Offline tests use a fake private-pipe peer, never a browser or account:

```sh
cd {baseDir}
bun test focus browser-host.test.js mappings
./mappings/node_modules/.bin/tsc --noEmit -p focus/tsconfig.json
bun run --cwd mappings typecheck
```

Headless DOM-probe tests are separately opt-in (`TEST_DOM_BROWSER=1`) and are not
desktop acceptance. Desktop focus experiments require explicit owner approval,
a disposable jailed profile, a decoy foreground application and loopback-only
fixtures. Follow [the measurement protocol](focus/README.md#desktop-acceptance).
No live compositor/browser coverage is claimed by offline tests.
