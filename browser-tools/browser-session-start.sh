#!/usr/bin/env bash
# Generic proxied browser-session bootstrap, reused by every logged-in site
# workflow (logged-in site
# work, and future ones). It:
#   1. sets AGENT_HTTPS_PROXY fresh from gopass (never reuses a stale env var),
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
#   browser-session-start.sh --url <URL> [--proxy-gopass <path>] [--minutes N] [--no-proxy]
#
# Defaults: dataimpulse sticky residential proxy (stable exit IP per session,
# better for logged-in sites), 25-minute guard.
set -euo pipefail
cd "$(dirname "$0")"

URL=""
PROXY_GOPASS="REDACTED-CREDENTIAL-PATH"
MINUTES=25
USE_PROXY=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2;;
    --proxy-gopass) PROXY_GOPASS="$2"; shift 2;;
    --minutes) MINUTES="$2"; shift 2;;
    --no-proxy) USE_PROXY=0; shift;;
    *) echo "✗ Unknown arg: $1" >&2; exit 1;;
  esac
done

[[ -n "$URL" ]] || { echo "✗ --url is required" >&2; exit 1; }

if [[ "$USE_PROXY" == 1 ]]; then
  echo "→ Setting proxy fresh from gopass ($PROXY_GOPASS)..."
  export AGENT_HTTPS_PROXY="https://$(gopass show -o "$PROXY_GOPASS")"
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
