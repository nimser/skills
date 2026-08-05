# Proxy Setup — Reader Notes

The browser-tools scripts optionally route Chrome and connectivity checks through
a proxy supplied in `AGENT_HTTPS_PROXY`. The scripts consume that variable but
do not create it. A local environment-specific builder is intentionally kept
outside this public skill.

## How the scripts consume the proxy

- `AGENT_HTTPS_PROXY` is a proxy URL and must never be printed or logged.
- `browser-start.js` passes only the proxy host and port to Chrome.
- `browser-nav.js` and `browser-content.js` answer proxy-auth challenges per page
  when the URL contains credentials.
- The proxy flag binds at Chrome launch; restart the container-local browser
  after changing the variable.
- Environment variables do not persist across separate agent shell calls. Set
  `AGENT_HTTPS_PROXY` in the same call as the browser command or use
  `browser-session-start.sh`.

## The builder contract

`browser-session-start.sh` invokes the command named by
`AGENT_PROXY_URL_CMD`. The command is local configuration and is not shipped by
this skill. A compatible command:

1. Prints a complete proxy URL only when explicitly requested.
2. Accepts the targeting options required by the local environment.
3. Never displays credentials on stderr or in logs.
4. Exits non-zero on missing credentials, invalid options, or other failures.

The skill passes builder arguments through without interpreting provider-
specific values. Common bootstrap defaults can be supplied with:

- `AGENT_PROXY_COUNTRIES`
- `AGENT_PROXY_ROTATING` (`true`/`false` or `1`/`0`)
- `AGENT_PROXY_SESSION_ID`
- `AGENT_PROXY_TTL`
- `AGENT_PROXY_ENTRY`

Command-line flags override these environment defaults.

## Safety rules

- Never echo or log `AGENT_HTTPS_PROXY`.
- Keep credential retrieval inside the local builder and out of argv, files, and
  terminal output.
- Use a stable proxy endpoint for logged-in sessions.
- Use rotating endpoints only for stateless work.
- If a proxy URL is exposed in persistent output, rotate its credentials through
  the local secret-management process.
