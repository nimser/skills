---
name: auto-commit-and-push
description: ALWAYS load this skill when you complete a significant task, update state, or modify files under the current repo. Configures the workspace for non-interactive automated git commits and pushes, bypassing YubiKey/FIDO2 touch prompts for git push by using a dedicated GitHub Deploy Key while preserving signed commits.
---

# Auto Commit and Push Setup

Use this skill when the user wants the agent to automatically commit and push changes in the background, without hanging on physical hardware token (YubiKey/FIDO2) prompts during `git push`.

This workflow allows local commits to remain cryptographically signed by the user's presence-less FIDO2 key (if configured), but forces `git push` to use a dedicated Deploy Key, explicitly bypassing the system SSH agent (`SSH_AUTH_SOCK`).

## Execution Steps

When invoked, execute the following steps in order using your Bash tool:

### 1. Ensure Agent Deploy Key Exists

Check if the global agent deploy key exists. If not, generate it:

```bash
if [ ! -f ~/.ssh/agent_deploy_key ]; then
  ssh-keygen -t ed25519 -f ~/.ssh/agent_deploy_key -N "" -C "opencode-agent-deploy-key"
  echo "Key generated."
else
  echo "Key already exists."
fi
```

### 2. Add Deploy Key to GitHub

Use the GitHub CLI (`gh`) to add the public key to the current repository as a Deploy Key with write access. (It's safe if it fails because it already exists).

```bash
gh repo deploy-key add ~/.ssh/agent_deploy_key.pub --allow-write --title "opencode Agent Deploy Key" || true
```

### 3. Configure Local Git Repository

Force the local repository to use the deploy key for SSH transport, bypassing the global config:

```bash
git config core.sshCommand "ssh -i ~/.ssh/agent_deploy_key -F /dev/null"
```

### 4. Perform the following commit ritual

**Force Push Safety:**

- NEVER use `git push --force`. Always use `--force-with-lease` to prevent overwriting others' work.
- ALWAYS ask for explicit user consent before force pushing. Explain why a force push is needed.
- If `--force-with-lease` fails (e.g., remote has diverged), do NOT fall back to `--force`. Instead, inform the user and ask them to manually run `git push --force` if they're sure.

**Auto-Commit Ritual:**

Whenever you complete a significant task, update state, or modify files, you MUST execute the following sequence of tasks in order to save and push the state with a suitable commit message. The commit will be automatically signed using the user's presence-less key, but for the push, you must bypass the user's SSH agent to avoid physical touch requirements.

Tasks sequence:

1. [ ] IMPORTANT: To get the proper `<compliant message>` commit message, load and strictly follow the instructions from the `commit-style-fun`, `commit-style-default`, or any available `commit-style*` skill for message style.
2. [ ] run `git add -A && git commit -m "<compliant message>" && env SSH_AUTH_SOCK="" git push` replacing the message based on previous step. If push fails, follow the "Force Push Safety" guidelines above
