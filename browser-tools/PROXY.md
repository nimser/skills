# Automation network selection

Network routing and CDP interaction permissions are independent choices.
`--direct-cdp` permits browser-wide protocol access; it does not disable the proxy.
The host broker owns network configuration and credentials.

## Choose the network

```sh
# Passive attachment to an existing proxy browser; never launches:
./browser-start.js
./browser-start.js --network=proxy

# With explicit approval for foreground interaction and launch:
./browser-start.js --foreground --seconds 120

# Only with separate explicit approval to bypass the proxy:
./browser-start.js --foreground --network=direct --seconds 120
```

Proxy is the default for every request, including attachment. `--network=direct`
asserts explicit user approval for direct network access across the entire
Automation profile, including restored tabs and extensions. It grants no CDP
interaction or launch permission by itself. Do not select it for proxy-required
work, because a proxy failed, or because an attachment was refused.

The selected network is fixed for the browser generation. A mismatched attachment
or foreground request fails before issuing approval, stopping, restarting or
switching the browser. There is no automatic proxy-to-direct fallback. To change
network, obtain approval to stop Automation, then a fresh launch approval with the
new explicit choice. Never stop or reopen an active task merely to satisfy a
mismatched request.

The broker advertises `networkSelection: generation-v1`, available networks and
its proxy default in `/status`. Live status, returned client state and startup
output name `networkMode`. Clients reject brokers without that capability and
reject returned identities whose network differs from the request.

Time-exception receipts do not grant network changes. Selecting one first
passively verifies the requested network and pinned generation through the
broker, without issuing a new grant. Proxy remains the default; add
`--network=direct` only for an explicitly approved direct-network browser.

## Host-only credentials

`AGENT_HTTPS_PROXY` is rejected in host mode. It does not select the network and
its absence does not imply direct access. Never pass a credential-bearing URL to
the broker, browser, container environment or CDP authentication helpers. The
host relay retrieves its upstream credentials locally; `--network=proxy` selects
that relay without transferring credentials.

Proxy routing is not an OS-level egress or anonymity boundary. Before an approved
account login, verify the exit address from that browser against the host relay.
A successful CLI/container check alone does not verify browser routing. Stop on
an address mismatch, authentication prompt or proxy failure; never retry directly.
Do not restart or rotate the upstream during a logged-in task; a sticky interval
does not guarantee uninterrupted address stability.

Host deployment and recovery: `~/.local/lib/browser-tools-host/README.md`.
Browser interaction approvals and lifetime: [focus/README.md](focus/README.md).
