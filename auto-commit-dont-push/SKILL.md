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

Always start with the default model planner. Arguments pass straight through:
`--style fun` for playful messages (default `classic`, or whatever
`git config agent.commit.style` says), `--dry-run` to inspect without staging.

Use `--message-file PATH|-` only after the driver explicitly reports model
plan/message validation failure after its retries. Never use it preemptively,
for editorial control, or to bypass policy, connection, signing, hook or drift
failures. It creates one commit, so use it only when the changes form one
cohesive group with no exclusions. After validation failure, use a reviewed
`--plan-file plan.json` instead when separate commits or exclusions are needed;
do not use that option to bypass model planning either. The driver appends the
attribution trailer deterministically. Use `--json` for per-attempt
`plannerDiagnostics`; report the actual errors, not a guessed common cause.

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

Never run `git add` or `git commit` yourself for this task, and never push:
pushing needs an explicit instruction from the user and the sibling
`auto-commit-and-push` skill. If the driver refuses, the answer is to tell the
user, not to find another way in.

A nested repository with its own pending work is refused by design: commit it
from inside that repository first, then run the driver again in the parent.
