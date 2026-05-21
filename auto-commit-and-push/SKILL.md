---
name: auto-commit-and-push
description: Configures the workspace for non-interactive automated git commits and pushes, bypassing YubiKey/FIDO2 touch prompts for git push by using a dedicated GitHub Deploy Key while preserving signed commits.
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

### 4. Update Agent Instructions
Find the active agent instruction file (usually `.opencode/agent/<agent-name>.md` or `AGENTS.md`) and use your Edit tool to append the following ritual to its system prompt:

```markdown
**Auto-Commit Ritual:**
Whenever you complete a significant task, update state, or modify files, you MUST execute the following bash sequence to save and push the state. The commit will be automatically signed using the user's presence-less key, but for the push, you must bypass the user's SSH agent to avoid physical touch requirements.

To maintain transparency and allow GitHub to properly credit the AI's contribution, you MUST append a `Co-authored-by` trailer to the commit message:

```bash
git add -A && git commit -m "chore: automated agent update

Co-authored-by: Claude <noreply@anthropic.com>" && git push
```
```

Inform the user once the configuration is complete and the instructions are updated!
