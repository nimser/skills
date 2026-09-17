---
name: auto-commit-and-push
description: ALWAYS load when committing/pushing in the current repo. Runs the commit driver, which gates the diff, signs the commit and pushes through a deploy key without hardware-token prompts.
---

# Auto Commit and Push

One command does the whole chore. It owns the signing pre-flight, the survey, the
junk-diff and nested-repo gates, the message, staging, hooks and push auth.

```bash
bash {baseDir}/commit.sh
```

`{baseDir}` is the directory this SKILL.md sits in; use the absolute path you
read it from. The launcher resolves the driver through symlinked skill trees.

Arguments pass straight through: `--style fun` for playful messages (default
`classic`, or whatever `git config agent.commit.style` says), `--message-file -`
for a single caller-written commit, `--plan-file plan.json` for a reviewed
multi-commit plan, `--dry-run` to inspect the plan without staging.

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

Never run `git add`, `git commit`, `git push` or `--force` yourself for this
task, and never disable signing or hooks. If the driver refuses, the answer is
to tell the user, not to find another way in.

A nested repository with its own pending work is refused by design: commit it
from inside that repository first, then run the driver again in the parent.
