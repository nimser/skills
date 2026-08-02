#!/bin/bash
set -e

# --- 0. Derive a per-repo key name -----------------------------------------
# GitHub deploy keys can only ever be attached to ONE repository each. Using
# a single global key file for every repo on a machine means the first repo
# you register "wins" and every other repo silently fails to authenticate
# ("Repository not found" even though the key itself is valid). To avoid
# that, derive a stable, repo-specific key filename from the remote URL so
# each repo gets its own keypair, while still being shared correctly across
# host/devcontainer as long as the same $HOME re-runs this script.

REMOTE_URL="$(git config --get remote.origin.url || true)"
if [ -z "$REMOTE_URL" ]; then
  echo "[auto-commit-and-push] No 'origin' remote found in $(pwd); aborting." >&2
  exit 1
fi

# git@github.com:owner/repo.git -> owner-repo
# https://github.com/owner/repo.git -> owner-repo
REPO_SLUG="$(echo "$REMOTE_URL" \
  | sed -E 's#^[a-zA-Z]+://##; s#^[^@]*@##; s#^[^:/]+[:/]##; s#\.git$##' \
  | tr '/' '-')"

KEY_NAME="agent_deploy_key_${REPO_SLUG}"
KEY_PATH="$HOME/.ssh/${KEY_NAME}"

# --- 1. Generate deploy key if missing --------------------------------------
if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "opencode-agent-deploy-key-${REPO_SLUG}"
  echo "[auto-commit-and-push] Deploy key generated at ${KEY_PATH}."
else
  echo "[auto-commit-and-push] Deploy key already exists at ${KEY_PATH}."
fi

# --- 2. Check gh auth --------------------------------------------------------
# Some environments export a restricted GITHUB_TOKEN (e.g. public_repo scope
# only) for use by agentic tools. That token cannot manage deploy keys on
# private repos, so always bypass it here in favor of the interactively
# authenticated gh account.
if ! GITHUB_TOKEN='' gh auth status &>/dev/null; then
  echo "[auto-commit-and-push] GitHub CLI not authenticated. Run: gh auth login" >&2
  exit 1
fi

# Figure out owner/repo for the gh -R flag.
GH_REPO="$(echo "$REMOTE_URL" \
  | sed -E 's#^[a-zA-Z]+://##; s#^[^@]*@##; s#^[^:/]+[:/]##; s#\.git$##')"

# Identify *which* machine/workspace this key belongs to, for the GitHub
# deploy-key title. $HOME/.ssh is not persisted across devcontainer rebuilds
# (and multiple devpod workspaces can bind-mount the same repo concurrently),
# so every rebuild mints a brand-new keypair. Plain `hostname` inside a
# container is usually just a random container ID and can't tell workspaces
# apart, so prefer devpod's own workspace identifier when present.
MACHINE_ID="${DEVPOD_WORKSPACE_UID:-${DEVPOD_WORKSPACE_ID:-$(hostname)}}"
KEY_TITLE="opencode Agent Deploy Key (${MACHINE_ID}:${REPO_SLUG})"

# --- 3. Add deploy key to GitHub (idempotent, errors are NOT swallowed) -----
# Also prune any *stale* key still registered under this exact same
# workspace/repo title but with different key material: since ~/.ssh isn't
# persisted across devcontainer rebuilds, a rebuilt workspace regenerates a
# brand-new keypair every time yet keeps the same $DEVPOD_WORKSPACE_UID, so
# without pruning, GitHub would accumulate one dead key per rebuild forever.
PUBKEY_CONTENT="$(awk '{print $1, $2}' "${KEY_PATH}.pub")"
EXISTING_KEYS_JSON="$(GITHUB_TOKEN='' gh repo deploy-key list -R "$GH_REPO" --json id,title,key 2>/dev/null || echo '[]')"

if echo "$EXISTING_KEYS_JSON" | jq -e --arg key "$PUBKEY_CONTENT" 'any(.[]; .key == $key)' >/dev/null; then
  echo "[auto-commit-and-push] Deploy key already registered on ${GH_REPO}."
else
  STALE_IDS="$(echo "$EXISTING_KEYS_JSON" | jq -r --arg title "$KEY_TITLE" '.[] | select(.title == $title) | .id')"
  for stale_id in $STALE_IDS; do
    if GITHUB_TOKEN='' gh repo deploy-key delete "$stale_id" -R "$GH_REPO" 2>&1; then
      echo "[auto-commit-and-push] Pruned stale deploy key ${stale_id} (same workspace, old keypair) from ${GH_REPO}."
    else
      echo "[auto-commit-and-push] WARNING: failed to prune stale deploy key ${stale_id} from ${GH_REPO}." >&2
    fi
  done

  if ! ADD_OUTPUT="$(GITHUB_TOKEN='' gh repo deploy-key add "${KEY_PATH}.pub" --allow-write \
      --title "$KEY_TITLE" -R "$GH_REPO" 2>&1)"; then
    echo "[auto-commit-and-push] FAILED to add deploy key to ${GH_REPO}:" >&2
    echo "$ADD_OUTPUT" >&2
    exit 1
  fi
  echo "[auto-commit-and-push] Deploy key added to ${GH_REPO}."
fi

# --- 4. Configure git to use the repo-specific deploy key -------------------
# Don't bake in an absolute path with the current $HOME; re-expand $HOME at
# push time so the same repo config works whether it's the host
# (/home/owner) or a devcontainer (/home/vscode).
#
# IdentityAgent=none + IdentitiesOnly=yes matter as much as -i: `-F /dev/null`
# only ignores ssh_config, ssh still talks to $SSH_AUTH_SOCK and offers the
# agent's keys FIRST. When the agent holds a YubiKey-backed ED25519-SK key,
# signing needs a touch, and a non-interactive git call gets
#   sign_and_send_pubkey: signing failed ... agent refused operation
# even though the deploy key is right there. Cutting the agent out of this
# repo's ssh makes bare `git fetch` / `git push` work with no touch at all.
git config core.sshCommand "ssh -i \$HOME/.ssh/${KEY_NAME} -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none"
echo "[auto-commit-and-push] Git configured to use deploy key ${KEY_NAME}."
