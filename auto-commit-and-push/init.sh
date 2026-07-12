#!/bin/bash
set -e

KEY_PATH="$HOME/.ssh/agent_deploy_key"

# 1. Generate deploy key if missing
if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "opencode-agent-deploy-key"
  echo "[auto-commit-and-push] Deploy key generated."
else
  echo "[auto-commit-and-push] Deploy key already exists."
fi

# 2. Check gh auth
if ! gh auth status &>/dev/null; then
  echo "[auto-commit-and-push] GitHub CLI not authenticated. Run: gh auth login"
  exit 1
fi

# 3. Add deploy key to GitHub
gh repo deploy-key add "${KEY_PATH}.pub" --allow-write --title "opencode Agent Deploy Key" 2>/dev/null || true
echo "[auto-commit-and-push] Deploy key added to GitHub."

# 4. Configure git to use deploy key.
# Don't use $KEY_PATH here so it's re-expanded by git each time to match current environment
git config core.sshCommand 'ssh -i $HOME/.ssh/agent_deploy_key -F /dev/null'
echo "[auto-commit-and-push] Git configured to use deploy key."
