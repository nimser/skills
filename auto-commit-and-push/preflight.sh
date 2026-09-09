#!/usr/bin/env bash
# Read-only pre-flight: verifies the SSH signing key is usable *before* anything
# is staged. Never mutates the repository.
set -uo pipefail

TAG="[auto-commit-and-push/preflight]"
say() { printf '%s %s\n' "$TAG" "$*"; }

PROBE_DIR=""
cleanup() { [ -n "$PROBE_DIR" ] && rm -rf "$PROBE_DIR"; }
trap cleanup EXIT

fail() {
  say "$1"
  cat <<'EOF'

  What to do:
    1. Plug in the YubiKey (or re-plug it if it was removed).
    2. Touch it / unlock it so the agent can load the signing key.
    3. Re-run this pre-flight; only proceed once it passes.

  Do NOT sign with any other key and do NOT disable signing.
EOF
  exit 1
}

SIGN="$(git config --get commit.gpgsign 2>/dev/null || true)"
case "$(printf '%s' "$SIGN" | tr '[:upper:]' '[:lower:]')" in
  false|off|no|0|"")
    say "commit signing is disabled (commit.gpgsign=${SIGN:-unset}) — nothing to check."
    exit 0
    ;;
esac

FORMAT="$(git config --get gpg.format 2>/dev/null || true)"
if [ -n "$FORMAT" ] && [ "$FORMAT" != "ssh" ]; then
  say "gpg.format=$FORMAT (not ssh) — no SSH agent check applies."
  exit 0
fi

RAW="$(git config --get user.signingkey 2>/dev/null || true)"
[ -n "$RAW" ] || RAW="$HOME/.ssh/git-signing.pub"
RAW="${RAW#key::}"

case "$RAW" in
  ssh-*|sk-ssh-*|ecdsa-*|sk-ecdsa-*)
    PUBKEY="$RAW"
    SOURCE="user.signingkey (literal)"
    ;;
  *)
    KEYFILE="$RAW"
    case "$KEYFILE" in "~/"*) KEYFILE="$HOME/${KEYFILE#\~/}" ;; esac
    [ -r "$KEYFILE" ] || fail "signing key file not readable: $KEYFILE"
    PUBKEY="$(head -n 1 "$KEYFILE")"
    SOURCE="$KEYFILE"
    ;;
esac

BLOB="$(printf '%s\n' "$PUBKEY" | awk '{print $2}')"
[ -n "$BLOB" ] || fail "could not extract a key blob from $SOURCE"

AGENT_KEYS="$(ssh-add -L 2>&1)"
STATUS=$?

if [ $STATUS -ne 0 ]; then
  fail "SSH agent unreachable or empty (ssh-add -L: ${AGENT_KEYS//$'\n'/ }). The YubiKey-backed signing key is not available."
fi

if ! printf '%s\n' "$AGENT_KEYS" | awk '{print $2}' | grep -qxF "$BLOB"; then
  fail "signing key from $SOURCE is NOT loaded in the SSH agent (YubiKey likely unplugged or locked)."
fi

# An agent lists sk-* keys whose token is absent, so listing alone proves nothing:
# only a real signature does. git fails with "agent refused operation" otherwise.
PROBE_DIR="$(mktemp -d)" || fail "could not create a temporary directory for the signature probe"
PROBE_KEY="$PROBE_DIR/signer.pub"
printf '%s\n' "$PUBKEY" > "$PROBE_KEY"

PROBE_ERR="$(printf 'preflight' |
  timeout 20 ssh-keygen -Y sign -q -n git -f "$PROBE_KEY" - 2>&1 >/dev/null)"
PROBE_STATUS=$?

if [ $PROBE_STATUS -eq 124 ]; then
  fail "signature probe timed out after 20s — the key likely requires a touch that nobody confirmed."
fi

if [ $PROBE_STATUS -ne 0 ]; then
  fail "signing key from $SOURCE is listed but cannot sign (${PROBE_ERR//$'\n'/ }). Its hardware token is absent or locked."
fi

say "signing key from $SOURCE signed a probe successfully — clear to proceed."
exit 0
