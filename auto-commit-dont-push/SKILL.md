---
name: auto-commit-dont-push
description: ALWAYS load this skill when you complete a significant task, update state, or modify files under the current repo. Runs the commit driver to make a signed local commit and never pushes.
---

# Auto Commit, Don't Push

One command does the whole chore. It owns the signing pre-flight, the survey, the
junk-diff and nested-repo gates, the message, staging and hooks.

```bash
bash {baseDir}/commit.sh
```

`{baseDir}` is the directory this SKILL.md sits in; use the absolute path you
read it from. The launcher resolves the driver through symlinked skill trees.

Where a `commit` tool is registered, call it instead: it runs the same driver and
returns every commit and exclusion whole, which shell output invites truncating.

Default to the fully scripted model planner. Use `--style fun` for playful
messages (default `classic`, or `git config agent.commit.style`), and `--dry-run`
to preview without staging. Human output includes phase progress, full messages
and errors. With `--json`, stdout is machine-readable and the human report goes
to stderr; do not hide that report from the user.

### Special-case session override

The session LLM may take ownership of bundling and preparation before any
failed attempt when a concrete limitation warrants it, such as distinct work
batches touching the same file. Explain the reason and recovery strategy first.
This is an exceptional/last-resort workflow, not an alternative for convenience
or editorial control. Read [the advanced workflow](../_scripts/commit/ADVANCED.md)
from the real skill directory before using it.

`--groups-file PATH|-` fixes the caller's groups and exclusions; the local model
only generates their messages. Add `--dry-run` for text generation without
execution. This is whole-file grouping, not hunk splitting. The advanced workflow
permits carefully preserved patch/stash preparation and, only when necessary,
manual signed commits; it never waives safety gates, signing, hooks or push policy.

Use `--message-file PATH|-` only after exhausted model validation retries, for one
cohesive group with no exclusions. Use a reviewed `--plan-file` after validation
failure when multiple groups or exclusions are needed. Neither is a workaround
for policy, transport, signing, hook or drift failures. The driver appends the
attribution trailer. `plannerDiagnostics` records per-attempt errors in JSON;
report actual failures rather than guessing their cause. For model failures,
read the capture directory named in the run output, or point `--debug-dir`
elsewhere outside the repository; it holds private request/raw-response artifacts
that may contain secrets and expires after 14 days. Never paste those files into
reports without review. After a timeout, check active model
work before retrying; client cancellation does not prove the server stopped.

The local model groups related whole files into commits and may exclude any
changed file with a reason. Every path must be accounted for exactly once.
Report exclusions and completed commits, including on failure. Excluded files
keep their contents and staging state; isolated commit indexes prevent leaks.
The driver never splits hunks and pushes only after all commits succeed.

## Reading the result

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Completed, dry run, or all files excluded | Report commits and every exclusion; all-excluded plans do not push. |
| 3 | Refused by policy | Relay the reason and stop; never bypass the gate. |
| 4 | Blocked | Report completed commits and the blocker; do not reset or retry blindly. |
| 1 | Harness error | Report it. |

Outside the documented session override, never run `git add` or `git commit` yourself
for this task. Never push under this skill, including during an override: pushing
requires an explicit user instruction and the sibling push skill. Never disable
signing or hooks or work around a policy refusal.

A nested repository with its own pending work is refused by design: commit it
from inside that repository first, then run the driver again in the parent.
