---
name: auto-commit-and-push
description: ALWAYS load when committing/pushing in the current repo. Sets up non-interactive commit+push (deploy key bypasses YubiKey/FIDO2 prompts on push; commits stay signed).
---

# Auto Commit and Push Setup

Forces `git push` through a dedicated Deploy Key (bypassing `SSH_AUTH_SOCK`/hardware-token prompts) while local commits stay signed by the user's normal key.

## Execution Steps

**Try first, set up only on failure.** Assume `init.sh` already configured the deploy key, GitHub registration, and `core.sshCommand`. Skip straight to surveying, committing and pushing; only run setup if something breaks.

### 1. Signing pre-flight (before touching the index)

Run it first, every time — a missing signing key otherwise only surfaces after the commit fails:

```bash
bash {baseDir}/preflight.sh
```

Exit 0 → proceed to step 2. Exit 1 → **stop**: nothing is staged, nothing is committed. Relay the script's message to the user (plug in / unlock the YubiKey) and retry the pre-flight once they confirm. Never work around it with another key or by disabling signing.

### 2. Survey before staging

Resolve and state the target repository's visibility with `gh repo view --json visibility` before staging; treat unknown visibility as public.

```bash
git status --porcelain && git diff --stat HEAD
find . -mindepth 2 -maxdepth 4 -name .git -not -path '*/node_modules/*' 2>/dev/null
```

**Nested repos:** every `find` hit is a repo of its own — the parent's `git add` either ignores its contents or records a bare gitlink, so its work silently never gets committed. For each hit, run `git -C <dir> status --porcelain`; if dirty, commit it first with this same skill, then the parent. If you don't, say in your report that `<dir>` was left uncommitted — never leave it unmentioned. `git submodule status` separates registered submodules (bump the gitlink deliberately) from stray inner repos (never stage the gitlink).

**Junk-diff triage:** stop and ask instead of committing when the diff is

- lockfile-only (`package-lock.json`, `uv.lock`, `Cargo.lock`, …) with no source change,
- a mass reformat or whitespace-only churn spanning unrelated files,
- generated output, vendored trees, build artifacts, or `.env`-shaped files.

Name the file(s) that triggered it and what you think happened. Committing these unasked is what forces a revert later.

### 3. Stage, commit, and push (happy path)

**Force Push Safety:** never `--force`; use `--force-with-lease` and only with explicit user consent. If `--force-with-lease` fails (diverged remote), don't fall back to `--force` — tell the user.

**Commit message style:** load and follow `commit-style-fun`, `commit-style-default`, or any available `commit-style*` skill.

**Message charset:** the body stays **ASCII**. The subject-line emoji and the `✦` bullet markers are the only exceptions — no CJK, no smart quotes, no em-dashes pasted in from source material; transliterate them. Non-ASCII slips only surface after the commit and cost an `--amend`.

**Commit and push** in one command. Stage the paths the survey cleared (`git add <paths>`); `git add -A` is only safe once step 2 showed no nested repos and no junk diff. Always use a heredoc for the message (never `-m` — avoids quoting breakage with ✦/apostrophes/backticks):

```bash
git add <paths> && git commit -F - <<'EOF' && env SSH_AUTH_SOCK="" git push
<type>(<scope>): <emoji> <description>

✦ <bullet 1>
✦ <bullet 2>

Co-authored-by: Claude <noreply@anthropic.com>
EOF
```

### 4. Handle failures (only if step 3 fails)

- **Pre-commit hook rejection:** follow `{baseDir}/../pre-commit-failure/SKILL.md`. Never modify lint config, suppress rules, or bypass hooks.
- **SSH / auth error** (`Permission denied`, `publickey`, missing identity file, `agent refused operation`): run `bash {baseDir}/init.sh` (bundled here — don't search for it). Expected after container rebuilds (~/.ssh wiped). Retry step 3 **once**, then inform the user.
- **Signing error** (`No private key found for public key`): the pre-flight should have caught this; commit *signing*, not push auth — init.sh won't help. Re-run the step 1 pre-flight, report its message to the user, don't improvise key overrides.
- **Non-auth error** (e.g. diverged remote): follow Force Push Safety above.
