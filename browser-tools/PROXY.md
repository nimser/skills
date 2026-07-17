# Proxy Setup — Reader Notes

The browser-tools scripts route Chrome (and `curl`) through a proxy exposed via
the `AGENT_HTTPS_PROXY` env var. The scripts only *consume* that var; producing
it is delegated to a small builder command that is **intentionally not shipped
here**, because it encodes personal choices (secret-store layout, proxy
provider, default targeting). This doc explains the contract so you can plug in
your own.

## How the scripts consume the proxy

- `AGENT_HTTPS_PROXY` = full URL with inline credentials, e.g.
  `https://user:pass@host:port` — same string you'd pass to `curl -x`.
- `browser-start.js` passes `--proxy-server=host:port` (credentials stripped —
  Chrome's flag takes no inline auth); `browser-nav.js`/`browser-content.js`
  answer the 407 challenge per navigation via `page.authenticate()`.
- The flag binds at Chrome launch: changing the var requires killing the
  `:9222` instance and relaunching.
- Env vars don't persist across separate agent bash calls — export and use in
  the *same* call, or use `browser-session-start.sh` which does it all in one
  process.

## The builder contract

`browser-session-start.sh` invokes `$AGENT_PROXY_URL_CMD` (default:
`dataimpulse-proxy-url`). Any command satisfying this works:

1. Prints a full proxy URL (`https://user:pass@host:port`) to **stdout**,
   nothing else on stdout.
2. Accepts (or ignores) targeting flags passed through:
   `--countries cc[,cc..]`, `--rotating`, `--session-id STR`, `--ttl N`.
3. Never displays credentials on stderr or in logs; human-readable summaries
   go to stderr in redacted form (host, port, targeting — no auth).
4. Exits non-zero on any failure (missing secret, invalid flags).

## Reference design (what the default builder does)

- **Secrets** live in a password manager (gopass): one entry with the password
  on line 1 and a `login: <base>` key line. The builder reads them into shell
  variables in-process; they never touch argv of visible commands, files, or
  the terminal.
- **Assembly** for a provider with login-encoded targeting (DataImpulse
  grammar, from their public docs):
  `login__key1.val1,val2;key2.val1:password@gw.dataimpulse.com:PORT`
  - `cr.fr,tw` — country targeting; omit for provider default
  - port `10000` = sticky session (add `sessttl.N`, 1–120 min rotation
    interval); port `823` = rotating per request (add `sessid.X` to pin one
    exit IP for ~30 min)
  - `state.arizona` / `city.madrid` — finer targeting, billed 2× by the
    provider
- **Safety latches** worth copying in your own builder:
  - refuse to print the URL unless an explicit `--print` flag is given (a bare
    invocation is a redacted dry run) — protects against accidental display
    by agents;
  - refuse to print when stdout is a TTY — protects interactive scrollback;
    the URL only ever travels through command substitution:
    `url=$(my-proxy-url --print ...)`;
  - validate every interpolated flag value (country codes, session ids) and
    assert credentials are URL-safe before embedding them in a URL.

## Hygiene rules (agents and humans)

- Never `echo`/log `AGENT_HTTPS_PROXY` or run the builder bare "to see it".
- Report only host, port, targeting, and the verified exit IP
  (`browser-proxy-check.js`).
- If the URL ever gets displayed anywhere persistent, rotate the proxy
  credentials at the provider.
- Rotating mode is for stateless scraping only — logged-in sessions need a
  stable exit IP (sticky or pinned).
