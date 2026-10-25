# Browser focus boundary

## Policy and coverage

No browser action is approved for background operation. The capability set is
empty on every platform, including Linux/Niri/Brave. All CDP dispatch requires an
unexpired owner-issued foreground lease. This is prevention, not a focus watcher
that attempts to repair redirected typing afterward.

Offline coverage: policy decisions, private-pipe framing, loopback gateway/client
integration, raw-WebSocket bypass attempts, ownership, revocation, expiry,
reconnects, legacy endpoint rejection and session timers use fake browser peers.
They do not measure a compositor, real browser, browser sandbox or GPU.
Firejail/bubblewrap pipe inheritance and live desktop/browser behavior require
separate acceptance; do not describe them as verified from these tests.

## Boundary

- `serve.ts` owns the jailed browser's inherited CDP descriptors 3/4. The browser
  has no remote-debugging TCP listener. The service never returns a raw endpoint.
- `gateway.ts` exposes one loopback WebSocket connection at a time. HTTP tab
  creation/activation/closure, origins, query-string routes and rebinding hosts
  are rejected. Reconnection has no retry loop and cannot inherit old sessions.
- `policy.ts` checks the host's approval file before every command. Unknown
  methods, browser-global mutations, activation, protocol tunnels and automatic
  attachment that can pause foreign pages are denied even under a lease.
- `host.js` checks static broker policy before requesting resume, so an old broker
  cannot start a raw-CDP browser before the client detects the mismatch.
- `client.js` verifies the gateway's live HTTP identity before opening a socket,
  then uses explicit flattened owned-page attachments, not Puppeteer's global
  auto-attachment. Browser/tab identity is pinned by `browser-config.js`.
  A failed owned-target lookup never creates a replacement automatically.
- `lease.ts` requires a private, owner-controlled runtime directory and files.
  Grant requires an interactive owner terminal and typed confirmation. Launch
  consent is consumed once, before browser spawn. Browser restart requires a new
  generation and launch grant. Agents must never issue or extend leases.

A lease names specific target IDs, dispatch scopes and at most 300 seconds. Only
confirmed blank targets created through the gateway join that lease. Popup,
worker and foreign target IDs do not. Changing a lease does not confer ownership
of targets created under the old lease; name approved targets explicitly.
Root browser metadata is available only inside a foreground lease. Protocol
scopes are not permission to mutate an account: JavaScript and trusted input can
invoke site code, focus requests, autosave and arbitrary site side effects.
Manual authentication/consent and payload authorization remain mandatory.

Dispatch checks cannot cancel code or input already sent to the browser. A
lease expiry, disconnect or timeout can leave an uncertain outcome, including
scheduled JavaScript. Do not resume typing or declare a mutation absent merely
because a lease expired. Hand back for owner inspection; never replay, activate,
restore focus, close a window or extend approval automatically. Idle browser
processes and old CDP attachments are left for approved lifecycle management.

The boundary covers trusted automation clients using the gateway, including raw
WebSocket helpers. It is not an adversarial same-UID/administrator boundary:
processes able to rewrite approval files, relaunch the browser outside its service
or access its private descriptors can defeat it. Keep untrusted containers out
of the host network/profile. An old deployed browser with a raw CDP listener is
not protected by editing the shared client; stop it during approved rollout.

## Owner-issued foreground windows

Run these commands manually on the host, only after approving the work scope and
pausing other typing. The examples are not instructions for agents to grant
approval. Installation of a lease is neither a login nor mutation authorization.

For a stopped gateway, grant one launch and blank-tab creation window:

```sh
bun ~/skills/browser-tools/focus/lease.ts grant --launch \
  --actions tab-create,inspect,javascript,navigate,pointer,screenshot --seconds 120
```

Then the approved client can start/resume the service through
`browser-start.js --host --resume`. Starting the service consumes launch consent.
Existing profile tabs and accounts remain; this does not authorize inspecting
them. The helper creates a blank owned tab only when there is no prior pin.
Niri/window/tab selection for manual login is always performed by the owner.

For an existing gateway, grant only required actions and an explicit owned target
ID from that client's `owned-tab.json`:

```sh
bun ~/skills/browser-tools/focus/lease.ts grant --target OWNED_TARGET_ID \
  --actions inspect,javascript --seconds 60
bun ~/skills/browser-tools/focus/lease.ts status
bun ~/skills/browser-tools/focus/lease.ts revoke
```

A new `tab-create` scope does not implicitly approve old tabs. Foreground scope
`keyboard` means browser-owned CDP key events, never desktop/global injection.
There is no `--force`, environment enable flag or background-to-foreground retry.
Container-local browsers, browser proxy authentication, cookie export and
automatic clean/keep-cookies session resets are unsupported.

The host runtime defaults to `$XDG_RUNTIME_DIR/browser-tools-focus-UID`, or the
same private subdirectory of the temporary directory when XDG runtime is absent.
`BROWSER_TOOLS_FOCUS_RUNTIME_DIR` must name one canonical private directory shared
by the host issuer, service and launcher; it is not a container-local lease cache.
Client instance files remain under `BROWSER_TOOLS_RUNTIME_DIR` as before.

## Desktop acceptance

**Pending: no real platform/browser focus coverage.** Do not run a desktop
experiment under the owner's live typing session. Obtain a dedicated foreground
window, specify affected fixtures/processes and get separate approval before
starting/stopping host services or applying host declarations.

Use a fresh disposable jailed browser profile with the same Firejail/bubblewrap,
sandbox, GPU and window-rule configuration as Automation. Do not point the fixture
at the real Automation profile, real source editors or account settings. Provision
that fixture with owner approval; the measurement runner refuses non-fixture
profile roots. Launch it through `serve.ts` with `--remote-debugging-pipe`, never
with a raw TCP port or sandbox/GPU-disable flags. Use its separate focus runtime
and instance state. Do not change the normal host service to run tests.

`desktop.ts` serves loopback-only autosaving editor/reference/decoy fixtures and
runs separate action scenarios through the guarded client. Start it only with
`BROWSER_TOOLS_DESKTOP_TEST_APPROVED=1` after explicit owner approval and a fixture
foreground lease. The owner manually selects the reference tab, then the decoy
application in a separate browser/process and types only disposable test text.
The runner never injects global keystrokes or activates/restores a window.

Record the continuous Niri `event-stream`, not just before/after snapshots. The
collector retains focus-transition and trusted fixture-key counts, never window
titles, key values or typed text. Keyboard-grab coverage beyond Niri's focus
events is unknown. Each scenario has a bounded 150 ms observation interval, not
proof against arbitrary delayed site callbacks. Reference/editor `visibilitychange` events measure active-tab
transitions in the isolated fixture browser; target events record unexpected
popup creation without persisting URLs. Fail acceptance if the stream is missing,
ends, or any intended decoy typing enters the autosaving editor, even transiently.

The scenario matrix includes navigation, reload, background blank-tab creation,
structural evaluation, DOM click/function-picker changes, coordinate clicks,
direct-CDP clicks, screenshots, reconnects, a login wall and popup creation.
Unknown/failed cases remain unsupported. Test failures/timeouts and lease
expiry/revocation with the fake transport first; repeat approved failure cases on
the supported desktop before enabling any background capability. No runner output
automatically enables a capability or establishes arbitrary-site neutrality.

Keep reports structural: runtime versions, scenario/status, compositor transition
counts, reference visibility transitions, unexpected target counts, decoy input
count, fixture-key count and fixture input count. Never commit typed text, editor contents, cookies,
tokens, account IDs, full personal titles, screenshots or runtime endpoints.

## Recovery

On denial, stop; use API/CLI. Never fall back to old ports, another driver, browser
profile files, disabled guards or foreground activation. Closed/mismatched pins
need explicit target replacement; an uncertain edit needs inspection, not replay.

A failed launch consumes its ticket. Inspect service/sandbox/descriptor support
and ask for a fresh bounded window after resolving the failure. Do not restart it
automatically. A stale `launch.lock` requires owner-approved recovery after
verifying no launch is in progress. Do not delete profile data to fix startup.

For host deployment/recovery use `~/.local/lib/browser-tools-host/README.md`.
Roll back declarations together with the browser stopped; retaining API/CLI-only
operation is safer than exposing an unguarded endpoint to regain functionality.
