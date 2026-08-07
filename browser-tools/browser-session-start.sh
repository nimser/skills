#!/usr/bin/env bash
# Generic proxied browser-session bootstrap, reused by logged-in site
# workflows. It:
#   1. sets AGENT_HTTPS_PROXY fresh via the locally configured proxy builder,
#      never reuses a stale env var, and never displays credentials,
#   2. verifies the proxy is live and logs the exit IP,
#   3. restarts the devpod-local Chrome so the --proxy-server flag actually
#      binds, relaunches with --profile so logins/cookies persist in this
#      devpod, and selects an available CDP port,
#   4. navigates to the target URL,
#   5. starts a wall-clock session guard.
#
# Login is ALWAYS manual — this script never fills credentials. If the target
# lands on a login form, stop and ask the user to log in in the visible window.
#
# Usage:
#   browser-session-start.sh --url <URL> [--countries cc[,cc..]] [--rotating]
#                            [--session-id X] [--ttl N] [--entry VALUE]
#                            [--minutes N] [--no-proxy]
#
# Proxy flags are passed through to the proxy-URL builder command
# (AGENT_PROXY_URL_CMD; see PROXY.md for the public contract).
# Common defaults may be supplied through AGENT_PROXY_COUNTRIES,
# AGENT_PROXY_ROTATING, AGENT_PROXY_SESSION_ID, AGENT_PROXY_TTL, and
# AGENT_PROXY_ENTRY. Command-line flags override those defaults.
# Avoid rotating endpoints for logged-in sites: a new IP per request can
# invalidate the session.
set -euo pipefail
cd "$(dirname "$0")"

URL=""
MINUTES=25
USE_PROXY=1
COUNTRIES="${AGENT_PROXY_COUNTRIES:-}"
ROTATING=0
SESSION_ID="${AGENT_PROXY_SESSION_ID:-}"
TTL="${AGENT_PROXY_TTL:-}"
ENTRY="${AGENT_PROXY_ENTRY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2;;
    --countries) COUNTRIES="$2"; shift 2;;
    --session-id) SESSION_ID="$2"; shift 2;;
    --ttl) TTL="$2"; shift 2;;
    --entry) ENTRY="$2"; shift 2;;
    --rotating) ROTATING=1; shift;;
    --minutes) MINUTES="$2"; shift 2;;
    --no-proxy) USE_PROXY=0; shift;;
    *) echo "✗ Unknown arg: $1" >&2; exit 1;;
  esac
done

[[ -n "$URL" ]] || { echo "✗ --url is required" >&2; exit 1; }

if [[ "$USE_PROXY" == 1 ]]; then
  PROXY_ARGS=()
  [[ -z "$COUNTRIES" ]] || PROXY_ARGS+=(--countries "$COUNTRIES")
  [[ -z "$SESSION_ID" ]] || PROXY_ARGS+=(--session-id "$SESSION_ID")
  [[ -z "$TTL" ]] || PROXY_ARGS+=(--ttl "$TTL")
  [[ -z "$ENTRY" ]] || PROXY_ARGS+=(--entry "$ENTRY")
  case "${AGENT_PROXY_ROTATING:-}" in
    ""|0|false|no|off) ;;
    1|true|yes|on) ROTATING=1 ;;
    *) echo "✗ AGENT_PROXY_ROTATING must be true/false or 1/0" >&2; exit 1;;
  esac
  [[ "$ROTATING" == 1 ]] && PROXY_ARGS+=(--rotating)

  PROXY_CMD="${AGENT_PROXY_URL_CMD:-}"
  [[ -n "$PROXY_CMD" ]] \
    || { echo "✗ AGENT_PROXY_URL_CMD is required when proxy mode is enabled — see PROXY.md" >&2; exit 1; }
  command -v "$PROXY_CMD" >/dev/null 2>&1 \
    || { echo "✗ proxy builder '$PROXY_CMD' not found in PATH — see PROXY.md for the expected contract" >&2; exit 1; }
  echo "→ Building proxy URL via the configured proxy builder (credentials never displayed)..."
  AGENT_HTTPS_PROXY="$("$PROXY_CMD" --print ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"})"
  export AGENT_HTTPS_PROXY
  echo "→ Verifying proxy..."
  ./browser-proxy-check.js
fi

echo "→ Restarting the devpod-local browser to bind the proxy flag..."
./browser-stop.js || true
./browser-start.js --profile

echo "→ Navigating to $URL (login is manual if a login form appears)..."
./browser-nav.js "$URL"

echo "→ Resetting session guard..."
node ./session-guard.js stop || true
echo "→ Starting the ${MINUTES}-minute session guard..."
node ./session-guard.js start "$MINUTES"

echo "✓ Ready. Report the proxy exit IP above to the user, then check whether a login form appeared."
