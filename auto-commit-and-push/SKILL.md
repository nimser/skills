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

**Commit Message Format:**
- Strictly follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): symbol description`, with `type` in `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Prefer meaningful repo-local scopes when applicable: package, app, feature, domain, service, or module names such as `feat(auth):`, `fix(api):`, `docs(readme):`.
- Put a relevant expressive character immediately after `:`. Use Unicode blocks U+1F300–1F5FF, U+1F600–1F64F, U+1F680–1F6FF, U+1F900–1F9FF, U+1FA70–1FAFF, U+2600–26FF, U+2700–27BF, or similar. Examples: 🌐 browser, 🔧 fix, ⚙️ config, 🤖 agent.
- Expressive characters are also welcome in the subject/body when they improve clarity or reduce length, but use them sparingly.
- For non-trivial commits (more than one change), include a body that clearly lists or explains the changes. Single-line commits are only acceptable for trivial, single-change commits.

**Force Push Safety:**
- NEVER use `git push --force`. Always use `--force-with-lease` to prevent overwriting others' work.
- ALWAYS ask for explicit user consent before force pushing. Explain why a force push is needed.
- If `--force-with-lease` fails (e.g., remote has diverged), do NOT fall back to `--force`. Instead, inform the user and ask them to manually run `git push --force` if they're sure.

To maintain transparency and allow GitHub to properly credit the AI's contribution, you MUST append a `Co-authored-by` trailer to the commit message:

```bash
git add -A && git commit -m "feat(skill-name): 🔧 description of change

Co-authored-by: Claude <noreply@anthropic.com>" && env SSH_AUTH_SOCK="" git push
```
```

Inform the user once the configuration is complete and the instructions are updated!
