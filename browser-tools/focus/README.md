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

Offline coverage uses fake browser pipes and includes a real Puppeteer client
against a fake protocol peer. It verifies passive/foreground/direct separation,
ownership, expiry/revocation, reconnects, discovery and timer checks, not real
Brave behavior, a compositor, GPU, sandbox or Firejail/bubblewrap pipe inheritance.
**Complete live regression and desktop focus acceptance remain blocked.** The
direct-to-scoped tab-lifecycle regression times out after a Puppeteer session;
disconnecting a gateway peer does not clear browser-root auto-attachment state.
Do not accept mixed-mode reuse or enable new background actions from isolated
successes or fake/headless tests.

## Transport

- `serve.ts` owns inherited CDP descriptors 3/4; Brave has no debug TCP listener.
- `gateway.ts` admits one loopback WebSocket peer at a time. HTTP tab verbs,
  browser origins, rebinding hosts and query-string routes are rejected.
- Default discovery is `/json/version`; elevated discovery is
  `/foreground/json/version` or `/direct/json/version`. Corresponding WebSocket
  paths append `/foreground` or `/direct` to the pinned base browser path. A
  separate guarded metadata-only port supports Puppeteer's root `/json/version`
  `browserURL` discovery; it returns the main gateway's direct WebSocket path and
  accepts no CDP sockets or tab verbs. It also requires direct-CDP approval.
- Elevated discovery/connection requires approval; every dispatch and incoming
  forwarding checks it again. An elevated connection never downgrades silently.
- `policy.ts` applies the passive allowlist without reading approval files.
  Foreground methods require action scopes and approved/created targets. Direct
  mode requires `direct-cdp` approval and permits unreviewed protocol methods.
  Nested CDP tunnels, protocol exposure and certificate bypass remain forbidden.
- `host.js` preflights static broker capabilities before requesting resume or an
  explicit grant. `client.js` checks live generation/mode/URL identity before
  opening its socket. Legacy v1/raw brokers fail before a launch request.
- Launch permission is separate and single-use. Default `/resume` never launches,
  even if a launch lease exists. `/foreground` validates an explicit bounded
  confirmation before allowing startup. No automatic restart/reset/retry.

A scoped grant names targets and actions for at most 300 seconds. Confirmed blank
owned tabs join its foreground scope; popups/workers do not. Replacing approval
never confers old foreground permissions. Passive ownership survives a grant's
expiry until target destruction or browser exit, not browser generation changes.
Default target lists/events are filtered to owned pages. Direct mode can expose
all Automation targets and allows focus-taking commands.

This boundary governs trusted automation clients, including raw WebSocket
helpers. It is not protection against same-UID/admin code able to rewrite grants
or launch outside the service. Keep untrusted host-network containers and daily
persona accounts out of this shared profile. The browser retains its sandbox,
GPU, jail and native-key access in every mode.

## Explicit approvals

After the user approves the affected profile, tab/actions and foreground window,
pause unrelated typing and use:

```sh
~/skills/browser-tools/browser-start.js --foreground --seconds 120
# Only for a separate, explicit request for browser-wide/direct CDP access:
~/skills/browser-tools/browser-start.js --foreground --direct-cdp --seconds 120
~/skills/browser-tools/browser-endpoint.js --direct-cdp
```

The flags assert explicit user consent and the broker records the short-lived
lease; no host-terminal prompt is needed. Agents must not select/renew elevation
because default attachment failed or an operation needs it. A direct-CDP request
requires both flags. The shared helper caps approval by the remaining recorded
task budget; direct clients must also honor task-budget changes.

The host runtime is `$XDG_RUNTIME_DIR/browser-tools-focus-UID`, or the same private
subdirectory of the temporary directory without XDG runtime. Its files and
`BROWSER_TOOLS_FOCUS_RUNTIME_DIR` are canonical owner-controlled state, not an
agent-writable container-local approval cache. Client instances remain under
`BROWSER_TOOLS_RUNTIME_DIR`. Environment flags cannot select elevation.

For narrower grants, the owner can still issue an interactive target/action lease:

```sh
bun ~/skills/browser-tools/focus/lease.ts grant --target OWNED_TARGET_ID \
  --actions inspect,javascript,activate --seconds 60
bun ~/skills/browser-tools/focus/lease.ts status
bun ~/skills/browser-tools/focus/lease.ts revoke
```

Selection and issuance are separate: a manually approved CDP helper must explicitly
choose the `/foreground` WebSocket path; a manual grant does not switch a default
client instance. Standard start commands issue their own broader scoped grant.
Do not infer mode from the grant's action list. `activate` restores
owned-page `Page.bringToFront`/`Target.activateTarget`; `keyboard` is CDP page
input, never global desktop injection. Manual login, consent, payload approval
and site restrictions are independent of foreground/direct permission.

Lease expiry/revocation blocks later dispatch, not already-sent work. Scripts,
network writes, delayed focus requests and automatic attachments can outlive a
connection or grant. Do not resume typing or declare an uncertain mutation absent
because approval expired. Inspect before retrying; never restore focus, close
windows, renew grants or restart browsers automatically.

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
protocol-session lifetime isolation and the complete mixed-mode matrix pass.
A new lease does not reconcile browser-root discovery, debugger waits or
attachments. Use an explicitly approved shutdown and fresh bounded launch for
mode handoff; never resume foreign targets or reset browser-wide state as a
silent fallback after revocation.

A failed launch consumes its ticket. Inspect service/jail/descriptor support and
request a fresh bounded window only after resolving the failure. A stale launch
lock needs approved recovery after verifying no launch remains in progress. Never
delete profile data, disable sandbox/GPU or fall back to an unconfined/raw browser.

Host deployment/recovery: `~/.local/lib/browser-tools-host/README.md`. Deploy the
broker and shared protocol version together with browser lifecycle approval;
keep the browser stopped if supported-runtime acceptance is unavailable.
