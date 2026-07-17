#!/usr/bin/env bash
# Generic proxied browser-session bootstrap, reused by every logged-in site
# workflow (logged-in site
# work, and future ones). It:
#   1. sets AGENT_HTTPS_PROXY fresh via dataimpulse-proxy-url (gopass-backed,
#      never reuses a stale env var, credentials never displayed),
#   2. verifies the proxy is live and logs the exit IP,
#   3. restarts Chrome so the --proxy-server flag actually binds (kills any
#      stale :9222 instance first, relaunches with --profile so the user's
#      logins/cookies persist across sessions),
#   4. navigates to the target URL,
#   5. starts a wall-clock session guard.
#
# Login is ALWAYS manual — this script never fills credentials. If the target
# lands on a login form, stop and ask the user to log in in the visible window.
#
# Usage:
#   browser-session-start.sh --url <URL> [--countries cc[,cc..]] [--rotating]
#                            [--session-id X] [--ttl N] [--entry gopass/path]
#                            [--minutes N] [--no-proxy]
#
# Proxy flags are passed through to dataimpulse-proxy-url (in PATH,
# chezmoi-managed). Defaults: sticky port with 60-min rotation interval,
# dashboard-default country. Site skills pass their own --countries (e.g.
# --countries fr). Avoid --rotating for logged-in sites:
# a new IP per request will invalidate the session.
set -euo pipefail
cd "$(dirname "$0")"

URL=""
MINUTES=25
USE_PROXY=1
PROXY_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2;;
    --countries|--session-id|--ttl|--entry) PROXY_ARGS+=("$1" "$2"); shift 2;;
    --rotating) PROXY_ARGS+=("--rotating"); shift;;
    --minutes) MINUTES="$2"; shift 2;;
    --no-proxy) USE_PROXY=0; shift;;
    *) echo "✗ Unknown arg: $1" >&2; exit 1;;
  esac
done

[[ -n "$URL" ]] || { echo "✗ --url is required" >&2; exit 1; }

if [[ "$USE_PROXY" == 1 ]]; then
  command -v dataimpulse-proxy-url >/dev/null 2>&1 \
    || { echo "✗ dataimpulse-proxy-url not found in PATH (chezmoi-managed, expected in ~/.local/bin)" >&2; exit 1; }
  echo "→ Building proxy URL via dataimpulse-proxy-url (credentials from gopass, never displayed)..."
  AGENT_HTTPS_PROXY="$(dataimpulse-proxy-url --print ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"})"
  export AGENT_HTTPS_PROXY
  echo "→ Verifying proxy..."
  ./browser-proxy-check.js
fi

echo "→ Restarting browser to bind the proxy flag (kills any existing :9222 instance first)..."
pkill -f "remote-debugging-port=9222" 2>/dev/null || true
sleep 1
./browser-start.js --profile

echo "→ Navigating to $URL (login is manual if a login form appears)..."
./browser-nav.js "$URL"

echo "→ Starting the ${MINUTES}-minute session guard..."
node ./session-guard.js start "$MINUTES"

echo "✓ Ready. Report the proxy exit IP above to the user, then check whether a login form appeared."
