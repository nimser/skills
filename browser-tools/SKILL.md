---
name: browser-tools
description: Passive owned-tab inspection by default; bounded foreground interaction and ordinary CDP/Puppeteer access only when explicitly requested.
---

# Browser tools

## Choose the mode

| Mode | Available operations | Approval |
| --- | --- | --- |
| **Background (default)** | Metadata, owned-page attachment, frame tree and structural DOM queries | No foreground lease; never launches, creates tabs, activates or runs JavaScript |
| **Foreground** | Owned-tab navigation, evaluation, screenshots, clicks, typing and explicit activation | Explicit user request; 15-minute default and ceiling without a host exception |
| **Direct CDP** | Ordinary CDP/Puppeteer connection, auto-attachment and broader browser protocol methods | Separate explicit request for browser-wide access; same bounded duration |

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
prove a different IP. Old generation-bound time exceptions cannot be reused.
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

`--foreground` asserts that the user approved that foreground window. It requests
a lease through the host broker and can launch the stopped Automation browser.
Agents may use it for an explicit user request; they must not select it for mere
convenience, API failure, default attach failure, or an expired session. No manual
host-terminal ceremony is required for this explicit command. The interactive
`focus/lease.ts grant` command remains available for narrower owner-issued scopes.

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

The endpoint helper prints `browserWSEndpoint` and `browserURL` for the selected
instance after verifying the live gateway and approval. Pass either to ordinary
`puppeteer.connect()` or use the WebSocket with a CDP client. Disconnect rather than
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
each command. Expiry/revocation blocks further sends and forwarding; reconnects
do not renew approval or silently downgrade an elevated connection. Direct clients
must honor the task budget; approvals requested through the shared start helper
are capped by its recorded remaining timer as well as the 15-minute ceiling.

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

Logged-in work requires a session timer (`node {baseDir}/session-guard.js start`
once for the approved task). The default and maximum task budget is 90 minutes;
shorter integer-minute budgets are supported. `BROWSER_GUARD_REQUIRE_SESSION=1`
also requires timers for public work. Expired/malformed timers block shared-client
sends; starting over an existing timer is refused. Never stop/start a timer or
renew a lease to extend an ongoing task. Optional Pi preflight cannot grant
foreground/direct capabilities.

### Requested time exceptions

An explicit user request to give a named session a duration also approves the
necessary bounded foreground preparation of that session's Automation instance;
the host agent performs it without a second confirmation. Verify the instance
and generation, detach stale client state with `browser-stop.js`, then use
`browser-start.js --foreground --network=proxy --seconds 120` if attachment or a
new owned tab is needed. Warn that focus can change before preparation. Preserve
existing task timers; an expired timer is a blocker, not permission to reset it.
Do not stop a running browser, rotate its proxy, switch networks or adopt foreign
tabs implicitly. Preparation and issuance are separate operations; this approval
does not authorize automatic renewal or beneficiary self-grants.

Only a different agent session executing on the verified host can issue a time
exception, through `bun {baseDir}/focus/exception.ts grant`. The beneficiary cannot
self-grant, including from the host; containers and broker requests cannot issue
exceptions. The issuer must supply the beneficiary's `PI_SESSION_ID` (the Pi
session UUID, not a devpod ID), an owned target, a duration such as `--duration 8h`
or an explicit expiry with timezone via `--until`, and a private receipt path.
Durations are positive integers with unit `s`, `m`, `h` or `d`; choose exactly one
time option. For an approved eight-hour unattended proxy session, the host agent
runs:

```sh
bun {baseDir}/focus/exception.ts grant \
  --session BENEFICIARY_PI_SESSION_UUID --duration 8h \
  --target OWNED_TARGET_ID --output /absolute/private/receipt.json
```

Add `--direct-cdp` only for separately approved browser-wide access; it leaves
proxy routing unchanged. The fixed deadline starts at issuance, not attachment.
Follow [focus/README.md](focus/README.md#requested-time-exceptions) for private
receipt transfer and revocation.
Never manufacture, edit or relocate host approval files to bypass these checks.

The beneficiary explicitly selects the private receipt with
`{baseDir}/browser-start.js --foreground --exception /absolute/private/receipt.json`.
Add `--direct-cdp` only if the exception separately authorizes it. Do not combine
`--exception` with `--seconds`. The receipt replaces both time limits with one
absolute deadline, without resetting the original task timer, launching a browser
or changing its network. It passively verifies the requested network and pinned generation through the
broker before connecting and requires the running gateway's exception capability;
legacy gateways fail closed. Other sessions cannot select the receipt through
shared helpers, and normal CDP endpoints cannot use the exceptional lease.
Puppeteer under an exception must use `browserWSEndpoint`, not `browserURL`.
Revocation or replacement blocks further dispatch; never renew an exception
automatically. Protect the receipt as a bearer capability and keep it out of Git
and logs. Session IDs identify trusted agents, not a hostile same-UID boundary.

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
