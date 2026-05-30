---
name: auto-commit-and-push
description: ALWAYS load this skill when you complete a significant task, update state, or modify files under the current repo. Configures the workspace for non-interactive automated git commits and pushes, bypassing YubiKey/FIDO2 touch prompts for git push by using a dedicated GitHub Deploy Key while preserving signed commits.
---

# Auto Commit and Push Setup

Use this skill when the user wants the agent to automatically commit and push changes in the background, without hanging on physical hardware token (YubiKey/FIDO2) prompts during `git push`.

This workflow allows local commits to remain cryptographically signed by the user's presence-less FIDO2 key (if configured), but forces `git push` to use a dedicated Deploy Key, explicitly bypassing the system SSH agent (`SSH_AUTH_SOCK`).

## Execution Steps

**Try first, set up only on failure.** Assume `init.sh` has already configured the deploy key, GitHub deploy-key registration, and `core.sshCommand`. Skip straight to committing and pushing. Only run setup if something breaks.

### 1. Stage, commit, and push (happy path)

**Force Push Safety:**

- NEVER use `git push --force`. Always use `--force-with-lease` to prevent overwriting others' work.
- ALWAYS ask for explicit user consent before force pushing. Explain why a force push is needed.
- If `--force-with-lease` fails (e.g., remote has diverged), do NOT fall back to `--force`. Instead, inform the user and ask them to manually run `git push --force` if they're sure.

**Commit message style:** Load and strictly follow the `commit-style-fun`, `commit-style-default`, or any available `commit-style*` skill for message style.

**Commit and push:** Stage all changes, then commit and push in one command. To avoid shell-quoting issues with multi-line messages, Unicode bullets (✦), apostrophes, or any special characters, **always** pass the commit message via a heredoc — never use `-m`:

```bash
git add -A && git commit -F - <<'EOF' && env SSH_AUTH_SOCK="" git push
<type>(<scope>): <emoji> <description>

✦ <bullet 1>
✦ <bullet 2>

Co-authored-by: Claude <noreply@anthropic.com>
EOF
```

> **Why heredoc, not `-m`?** The `-m` flag requires the entire message inside shell quotes. Multi-line messages with ✦ bullets, em-dashes (—), curly quotes (''), apostrophes, or other Unicode regularly break single-quote or double-quote wrapping. A heredoc with a quoted delimiter (`<<'EOF'`) passes the body completely literally — no expansion, no quoting conflicts — and works for any valid commit message.

### 2. Handle failures (only if step 1 fails)

- **Pre-commit hook rejection:** Read and strictly follow `{baseDir}/../pre-commit-failure/SKILL.md`. Never modify linting configuration, suppress rules, or bypass git hooks.
- **SSH / auth error** (e.g., `Permission denied`, `publickey`, `Host key verification failed`): re-run `init.sh`, then retry step 1 **once**. If it still fails, inform the user.
- **Non-auth error** (e.g., diverged remote): follow the "Force Push Safety" guidelines above.
