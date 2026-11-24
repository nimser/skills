# Browser modes and focus boundary

## Policy and coverage

`browser-tools-focus-v2` defaults to passive metadata and structural reads of
confirmed owned pages. No lease is needed for that allowlist. Background clients
cannot create/activate/navigate tabs, execute JavaScript, inject input, capture
screenshots or enable auto-attachment, even if an elevated lease exists.

Foreground clients explicitly select owned-tab interaction and activation under
a bounded lease. Direct clients explicitly select broader, browser-wide CDP;
ordinary Puppeteer connections and automatic attachment are supported in that
mode. Direct mode does not enforce owned-tab isolation. It is not a fallback.

Offline coverage uses fake browser pipes and a real Puppeteer client against a
fake protocol peer. It models retained debugger waits, nested session teardown,
direct-to-scoped tab lifecycle, idle expiry/revocation, stale replies, cleanup
failures and navigation deadlines. It does not verify real Brave behavior, a
compositor, GPU, sandbox or Firejail/bubblewrap pipe inheritance.
**Complete live regression and desktop focus acceptance remain blocked.**
Per-client session isolation requires supported-runtime validation and the full
mixed-mode matrix. Do not accept mixed-mode reuse or enable new background
actions from isolated successes or fake/headless tests.

## Transport

- `serve.ts` owns inherited CDP descriptors 3/4; Brave has no debug TCP listener.
- `gateway.ts` admits one loopback WebSocket peer at a time. HTTP tab verbs,
  browser origins, rebinding hosts and query-string routes are rejected.
- Every peer gets a private flattened browser session through
  `Target.attachToBrowserTarget`. Root client commands are routed through it;
  descendant session IDs belong to that connection only. The persistent pipe
  root handles gateway lifecycle controls, never client auto-attachment.
- Startup commands wait for private-session allocation, with a 1 MB queue bound.
  Disconnect, approval replacement, expiry and revocation retire that session
  tree. Idle approvals are rechecked every 100 ms; dispatch and replies/events
  also check approval. New socket admission waits for teardown acknowledgement.
- Allocation and teardown have five-second deadlines. Unsupported allocation,
  malformed replies, cleanup errors or timeouts block gateway reuse until
  explicitly approved recovery; there is no fallback to the persistent root.
- Default discovery is `/json/version`. Elevated endpoints require a
  `/window/<token>` capability. Elevated WebSocket paths also carry `/foreground`
  or `/direct`. Use `browserWSEndpoint` for Puppeteer. Root `browserURL` discovery
  cannot carry the capability.
- Elevated discovery/connection requires approval; every dispatch and incoming
  forwarding checks it again. An elevated connection never downgrades silently.
- `policy.ts` applies the passive allowlist without reading approval files.
  Foreground methods require action scopes and approved/created targets. Direct
  mode requires `direct-cdp` approval and permits unreviewed protocol methods.
  Nested CDP tunnels, protocol exposure and certificate bypass remain forbidden.
- `host.js` preflights static broker capabilities before requesting resume or an
  explicit grant. `client.js` checks live generation/mode/URL identity before
  opening its socket. Legacy v1/raw brokers fail before a launch request.
  Navigation shares one monotonic deadline across page enablement, navigation,
  DOM-load waiting and frame-tree reads, capped by the confirmed window.
  Timeout errors name the protocol method, not URLs or command parameters.
- Launch permission is separate and single-use. Default `/resume` never launches,
  even if a launch lease exists. `/foreground` requires a positive host desktop
  confirmation before allowing startup. No automatic restart, reset or retry.

A scoped window names the pinned target and action classes for 900 seconds by
default, or the duration shown at confirmation. Blank owned tabs join its
foreground scope. Popups and workers do not. Replacing approval
never confers old foreground permissions. Passive ownership survives a grant's
expiry until target destruction or browser exit, not browser generation changes.
Default target lists/events are filtered to owned pages. Direct mode can expose
all Automation targets and allows focus-taking commands.

This boundary governs trusted automation clients, including raw WebSocket
helpers. It is not protection against same-UID/admin code able to rewrite grants
or launch outside the service. Keep untrusted host-network containers and daily
persona accounts out of this shared profile. The browser retains its sandbox,
GPU, jail and native-key access in every mode.

## Launch-time network choice

The host defaults to proxy routing for both passive attachment and explicit
foreground/direct-CDP requests. `--network=direct` asserts separate explicit
approval to bypass the proxy for the whole Automation profile; `--direct-cdp`
only changes protocol permissions. The network flag alone never launches a
browser. See [../PROXY.md](../PROXY.md).

The broker advertises `networkSelection: generation-v1` and reports `networkMode`
in status and returned state. Each browser generation has one network mode.
An incompatible request fails before a grant, restart or switch; a failed proxy
never causes direct access. A network change needs an approved stop and a fresh
launch request, not an attachment retry.

## Confirming a browser window

In Pi, the owner runs `/navigation` for 15 minutes or `/navigation 90` for
90 minutes. The equivalent owner-run shell commands are:

```sh
~/skills/browser-tools/browser-start.js --foreground
~/skills/browser-tools/browser-start.js --foreground --seconds 5400
# Only for a separate request for browser-wide CDP access:
~/skills/browser-tools/browser-start.js --foreground --direct-cdp
~/skills/browser-tools/browser-endpoint.js --direct-cdp
```

The host Wayland dialog displays the session, network, scope and duration.
Only a positive desktop answer starts the fixed window. No caller-supplied
approval field, terminal answer, timeout, reconnect or background resume can
issue a window. The host refuses concurrent prompts and drops requests if the
browser generation changes while waiting. Renewals are unlimited, but each
requires a new dialog and a new affirmative answer. The shell/API can request
that dialog but cannot supply the answer. Agents must leave renewal requests to
the owner.

Expiry or revocation retires protocol sessions but does not undo scripts, input,
network effects or delayed focus changes. Inspect before retrying uncertain work.
Manual login, site rules, mutation approval, network changes and browser-wide
CDP remain separate from a scoped navigation window.

The host stores the active window in `$XDG_RUNTIME_DIR/browser-tools-focus-UID`
and returns a random bearer capability to the requesting instance. Shared
clients check the Pi session and deadline. The gateway checks the capability
and expiry at discovery, admission, dispatch and forwarding. Keep the capability
and elevated URLs out of logs and Git. A confirmed replacement retires the
previous elevated connection. The host owner can inspect or revoke it with
`bun ~/skills/browser-tools/focus/lease.ts status` or `revoke`.

## Fixture-only foreground regression

After approval for a dedicated desktop window, run:

```sh
BROWSER_TOOLS_DESKTOP_TEST_APPROVED=1 bun ~/skills/browser-tools/focus/regression.ts
```

`regression.ts` creates fresh `focus-fixture-*` Automation-equivalent jails and
isolated gateway/client runtimes. `BROWSER_TOOLS_TEST_LAUNCHER` can name an absolute
TypeScript launcher source for testing without replacing the installed launcher.
The launcher must preserve CDP descriptors with Firejail `--keep-fd=3,4`, not bare
`--keep-fd` or `--keep-fd=all`.

The runner exercises ordinary Puppeteer with WebSocket and HTTP discovery,
scoped interaction, navigation/reload, owned-tab lifecycle, popups, a local login
wall, DOM/picker changes, screenshots, autosave, revocation/expiry and passive
mode denial. A separate jailed decoy provides a compositor-focus comparator.
Native namespace/seccomp and GPU checks remain enabled. Deliberate activation
is confined to fixture windows; there is no global input or personal-window
restoration. Fixture leases share one four-minute deadline; cleanup stops only
fixture processes and removes their grants. Failures abort the matrix.

Reports retain versions, booleans and structural counts, not screenshots or
input text. CDP-generated trusted input is not physical-keyboard redirection
coverage. Physical typing, FIDO authentication/hotplug and arbitrary delayed
focus effects need their own manual acceptance. A partial matrix is not a pass.

## Desktop acceptance

Obtain separate explicit approval for a dedicated foreground window, affected
fixtures/processes and any host service changes. Do not experiment under ongoing
personal typing. Use a fresh disposable `focus-fixture-*` jailed profile with the
same Firejail/bubblewrap, sandbox, GPU and window-rule configuration as Automation.
Never use the real Automation profile, source editors or account settings.

Provision the fixture with approval. Launch via `serve.ts` and private pipes in a
separate runtime; do not change the normal service for tests or expose a raw port.
The runner refuses non-fixture roots. Set `BROWSER_TOOLS_DESKTOP_TEST_APPROVED=1`
only for the approved experiment and supply a fixture foreground lease.
`desktop.ts` serves loopback autosaving editor/reference/decoy fixtures. The owner
manually selects the reference tab, then a decoy in another process, typing only
disposable text. The runner never injects global input or activates/restores windows.

Collect the continuous Niri `event-stream`, not before/after snapshots. Keep focus
transition and trusted fixture-key counts, never titles, keys or typed text.
Keyboard-grab coverage beyond Niri events is unknown. Each scenario's 150 ms
observation interval is bounded evidence, not arbitrary-site/delayed-callback
proof. Fixture `visibilitychange` measures active-tab transitions; target events
count unexpected popups without persisting URLs. Missing/ended streams, redirected
input, or inconclusive decoy samples fail acceptance, even after transient theft.

The matrix covers navigation, reload, blank-tab creation, evaluation, DOM/picker
changes, coordinate/CDP clicks, screenshots, reconnects, login walls and popups.
Test expiry/failure cases with fake transport first, then repeat approved cases
on the supported desktop. Unknown/failed cases remain unsupported. No report
automatically enables a background capability. Keep only versions, scenario/status
and structural transition/visibility/target/input counts. Never commit editor
contents, credentials, account IDs, screenshots or runtime endpoints.

## Recovery

On denial, use the passive allowlist or API/CLI; ask before upgrading. Closed or
mismatched pins require an explicit replacement. An uncertain edit needs
inspection, not replay. Direct mode changes the trust scope, not the recovery rule.

Do not hand a direct-CDP browser generation to a scoped mutation task until
supported-runtime session isolation and the complete mixed-mode matrix pass.
Session isolation requires a freshly launched gateway; updating shared files or
issuing a lease cannot repair a running gateway's legacy browser-root discovery,
debugger waits or attachments. A failed teardown blocks all new connections.
Use an explicitly approved shutdown and fresh bounded launch for recovery;
never resume foreign targets or reset browser-wide state as a silent fallback.

A failed launch consumes its ticket. Inspect service/jail/descriptor support and
request a fresh bounded window only after resolving the failure. A stale launch
lock needs approved recovery after verifying no launch remains in progress. Never
delete profile data, disable sandbox/GPU or fall back to an unconfined/raw browser.

Host deployment/recovery: `~/.local/lib/browser-tools-host/README.md`. Deploy the
broker and shared protocol version together with browser lifecycle approval;
keep the browser stopped if supported-runtime acceptance is unavailable.
