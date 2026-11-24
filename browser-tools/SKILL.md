---
name: browser-tools
description: Passive owned-tab inspection by default; bounded foreground interaction and ordinary CDP/Puppeteer access only when explicitly requested.
---

# Browser tools

## Choose the mode

| Mode | Available operations | Approval |
| --- | --- | --- |
| **Background (default)** | Metadata, owned-page attachment, frame tree and structural DOM queries | No foreground lease; never launches, creates tabs, activates or runs JavaScript |
| **Foreground** | Owned-tab navigation, evaluation, screenshots, clicks, typing and explicit activation | Human confirmation on the host desktop, 15 minutes by default |
| **Direct CDP** | Ordinary CDP/Puppeteer connection, auto-attachment and broader browser protocol methods | Separate human confirmation for browser-wide access, same duration rules |

Use application APIs/CLI for mutations while the owner works elsewhere. Default
inspection uses a small protocol allowlist, not arbitrary JavaScript labelled as
read-only. Passive dispatch/ownership is covered by fake-pipe tests; live desktop
focus coverage remains **unmeasured**. Background navigation, screenshots, new tabs,
DOM clicks, layout snapshots and evaluation remain unsupported until measured.
No automatic upgrade, driver fallback, activation, focus restoration or retry.

Autosaving editors are persistent mutations: redirected physical typing can alter
source. Owned targets, `background: true` and Niri's unfocused-open rule are not
proof of desktop safety. Even a DOM click can invoke focus-changing site code.
Passive reads do not cancel old site callbacks or guarantee site-initiated focus
behavior. Stop if task preconditions or the supported-runtime evidence are absent.

## Network choice

Network defaults to the host proxy, independently of interaction mode. Only an
explicit user approval to bypass it permits `browser-start.js --network=direct`.
That option affects every Automation tab and extension; it neither grants
foreground access nor launches a stopped browser by itself. `--direct-cdp` does
not change network routing. See [PROXY.md](PROXY.md).

The network is fixed at launch. Mismatched requests fail before granting approval
or touching the running browser; never restart, switch or fall back to direct
access automatically. Startup output and client state report `networkMode`.

For an explicitly approved pre-login proxy rotation, run
`{baseDir}/browser-rotate.js --confirm-idle` from the pinned client instance.
The flag asserts approval to stop every Automation tab/task. It stops only the
proxy browser/relay and preserves cookies and timers; no relaunch or grant is
implicit. A separately approved foreground start selects the next sticky port.
Verify changed browser/relay exits before login; a different port does not
prove a different IP. A window from an earlier browser generation cannot be reused.
See [PROXY.md](PROXY.md#explicit-pre-login-rotation); never rotate to bypass a
site restriction or while logged-in work is running.

## Default workflow

```sh
{baseDir}/browser-start.js                 # attach to a running guarded browser
{baseDir}/browser-inspect.js 'input,button' # structural inventory, no field values
{baseDir}/browser-stop.js                  # detach only; leave browser/tabs open
```

`--host --resume` remains an alias for default attachment. Default startup never
launches a stopped browser or creates a missing owned tab. A first browser/tab
setup requires an explicitly approved foreground window. Starting the default
mode again clears the client's elevated mode selection without extending leases.

Each instance pins the gateway generation and owned tab in `owned-tab.json`.
Never choose the selected, last or newest foreign tab. Closed/mismatched pins
fail rather than create a replacement. An explicit `browser-nav.js URL --new`
under foreground approval creates and pins a replacement. Scoped/default clients
cannot inspect or auto-attach unrelated tabs; direct mode has a broader contract.

## Explicit foreground interaction

When the user explicitly authorizes foreground work, name the affected profile,
tab/actions and duration, and warn that focus may change and other typing must
pause. Then select it deliberately:

```sh
{baseDir}/browser-start.js --foreground --seconds 120
{baseDir}/browser-nav.js https://example.test --no-login-wait
{baseDir}/browser-nav.js https://example.test --activate --no-login-wait
```

In Pi, `/navigation` requests 15 minutes and `/navigation 90` requests 90 minutes.
If the slash command is unavailable, ask the user to run
`browser-start.js --foreground` from that session. Omit `--seconds` for 15 minutes.
The host desktop displays the session, scope and exact duration. Refusal, closure
and timeout grant nothing. On expiry, stop and hand back to the user. Never run
a renewal command or open a renewal prompt on the user's behalf.

Navigation does not call activation automatically. `--activate`, `Page.bringToFront`
and `Target.activateTarget` work under the `activate` scope for owned targets.
Keyboard methods dispatch to the browser page, never to desktop/global input.
A scoped lease does not authorize browser-wide auto-attachment or unknown methods;
request direct CDP separately if the task needs them.

Login, consent, security keys and mutation/payload authorization remain separate.
Never bypass an authentication wall, CAPTCHA, throttling or access denial. A
foreground window permits focus-changing interaction, not unapproved account work.

## Explicit direct CDP / Puppeteer

Only when the user explicitly requests direct/browser-wide access:

```sh
{baseDir}/browser-start.js --foreground --direct-cdp --seconds 120
{baseDir}/browser-endpoint.js --direct-cdp
```

The endpoint helper prints `browserWSEndpoint` after verifying the live gateway
and window. Use it with `puppeteer.connect()` or a CDP client. Disconnect rather than
call `browser.close()` unless closing the whole shared browser was also approved.
Do not print/store runtime endpoints in tracked logs.

This is a normal protocol connection through the private-pipe gateway, not a
permanently exposed raw Brave port. Direct mode restores auto-attachment, generic
protocol methods, input and focus-taking behavior; **owned-tab isolation is not
enforced in this mode**. Popups and other Automation tabs can be visible to the
client. Do not use daily-persona accounts in this browser. Nested CDP tunnels,
protocol exposure and certificate-error bypass remain denied. Sandbox/GPU-disable
launch flags remain denied in every mode.

The default WebSocket/HTTP discovery paths never switch to direct mode because a
lease exists. Elevated paths require a valid lease at discovery, connection and
each command. Expiry or revocation blocks further sends and forwarding.
Reconnects do not renew the window or silently downgrade an elevated connection.

## Lifetime and uncertainty

A lease binds one browser generation, approved action classes and explicit
scoped targets. Confirmed newly created tabs join that scoped lease; unrelated
popups/workers do not. New grants do not inherit old foreground target permission.
Passive ownership of confirmed tabs lasts until target destruction/browser exit,
so structural reads can continue after a foreground window without another grant.

Each connection owns a browser protocol-session tree. Disconnect or approval
expiry/revocation retires it; the next client waits for teardown acknowledgement.
Allocation/cleanup failure blocks reuse, with no persistent-root fallback.
Supported-runtime session isolation and mixed-mode acceptance remain unmeasured;
a running legacy gateway requires explicitly approved shutdown and fresh launch.

Protocol teardown does not undo browser-wide settings, input, network mutations,
page callbacks or scripts. A command timeout alone does not cancel work or end
the connection. Navigation uses one bounded deadline across protocol requests and
DOM-load waiting; timeout errors name methods without payloads. Do not resume
typing or declare a mutation absent merely because approval expired or cleanup
completed. Stop and hand back for inspection; never replay, restore focus, restart
or renew automatically.
The gateway is not protection against hostile same-UID/admin code able to rewrite
approval files or launch another browser. Trust host-network devpods appropriately.

## Helpers and runtime

- `browser-inspect.js [CSS_SELECTOR]`: passive structural tags/attributes, at most
  100 results; never prints field values or page text.
- `browser-eval.js`, `browser-pick.js`, mapping `check`: foreground JavaScript.
- `browser-nav.js`: foreground navigation; `--new` needs tab creation and
  `--activate` deliberately focuses the owned page.
- `browser-click-xy.js`: foreground pointer input.
- `browser-screenshot.js`: foreground screenshot.
- `browser-login-wait.js`: manual login detection/wait, foreground JavaScript.
- `browser-content.js`: foreground navigation/evaluation/inspection.
- Cookie export, automatic clean/keep-cookies resets, container-local profile
  copying and automatic session bootstrap remain unsupported. Broader direct CDP
  access does not authorize credential extraction or implicit destructive resets.

Host setup: `~/.local/lib/browser-tools-host/README.md`. Preserve the Automation
profile, Firejail/bubblewrap, security-key access, sandbox and visible GPU rendering.
Legacy v1/raw endpoints are rejected before resume; deploy broker and shared skill
versions together. No browser TCP debug listener or unconfined-browser fallback.

Client state uses `BROWSER_TOOLS_RUNTIME_DIR`, `BROWSER_TOOLS_INSTANCE`/`PI_SESSION_ID`
and optionally `BROWSER_TOOLS_STATE`. Host approvals use the canonical private
`BROWSER_TOOLS_FOCUS_RUNTIME_DIR`; agents must not rewrite or relocate files to
manufacture approval. `BROWSER_CDP_*` and guard-disable variables cannot select an
elevated mode. Explicit CLI options, not environment defaults, select elevation.

`node {baseDir}/session-guard.js check` reports remaining time without changing
it. The fixed deadline starts when the user confirms. No separate task timer or
third-party grant is needed. The session state and elevated endpoints carry a
private bearer capability. Keep them out of Git, reports and logs.

## Direct shared-client helpers and tests

Read [BROWSER-MAPPINGS.md](BROWSER-MAPPINGS.md) for paced project workflows.
`connectBrowser()` and `ownedPage()` use the selected instance mode; creating a
CDP session does not itself escalate permissions. `page.bringToFront()`,
`page.keyboard.type()` and page CDP input are available under foreground scopes.
Unsupported shared-client APIs require a deliberate direct-mode request, not an
independent attachment fallback. Keep dependent mutations sequential, inspect
preconditions and verify persisted results; never retry uncertain writes.

Runtime details and measurement protocol: [focus/README.md](focus/README.md).

```sh
cd {baseDir}
bun test
./mappings/node_modules/.bin/tsc --noEmit -p focus/tsconfig.json
bun run --cwd mappings typecheck
```

The offline suite uses fake peers, including a real Puppeteer client attached to
a fake CDP server; it starts no browser. `TEST_DOM_BROWSER=1` separately opts into
headless DOM-probe tests, not desktop acceptance. Desktop tests require separate
explicit approval, disposable jailed fixtures and continuous compositor evidence.
