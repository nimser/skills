---
name: auto-commit-and-push
description: ALWAYS load when committing/pushing in the current repo. Sets up non-interactive commit+push (deploy key bypasses YubiKey/FIDO2 prompts on push; commits stay signed).
---

# Auto Commit and Push Setup

Forces `git push` through a dedicated Deploy Key (bypassing `SSH_AUTH_SOCK`/hardware-token prompts) while local commits stay signed by the user's normal key.

## Execution Steps

**Try first, set up only on failure.** Assume `init.sh` already configured the deploy key, GitHub registration, and `core.sshCommand`. Skip straight to committing and pushing; only run setup if something breaks.

### 1. Stage, commit, and push (happy path)

**Force Push Safety:** never `--force`; use `--force-with-lease` and only with explicit user consent. If `--force-with-lease` fails (diverged remote), don't fall back to `--force` — tell the user.

**Commit message style:** load and follow `commit-style-fun`, `commit-style-default`, or any available `commit-style*` skill.

**Commit and push** in one command. Always use a heredoc for the message (never `-m` — avoids quoting breakage with ✦/em-dash/apostrophes):

```bash
git add -A && git commit -F - <<'EOF' && env SSH_AUTH_SOCK="" git push
<type>(<scope>): <emoji> <description>

✦ <bullet 1>
✦ <bullet 2>

Co-authored-by: Claude <noreply@anthropic.com>
EOF
```

### 2. Handle failures (only if step 1 fails)

- **Pre-commit hook rejection:** follow `{baseDir}/../pre-commit-failure/SKILL.md`. Never modify lint config, suppress rules, or bypass hooks.
- **SSH / auth error** (`Permission denied`, `publickey`, `Host key verification failed`): re-run `init.sh`, retry step 1 **once**, then inform the user if it still fails.
- **Non-auth error** (e.g. diverged remote): follow Force Push Safety above.
