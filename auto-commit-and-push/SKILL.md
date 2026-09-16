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
to write the message yourself on stdin instead of having the local model write
it, `--dry-run` to see the message without committing.

## Reading the result

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Committed and pushed | Report the subject line. |
| 3 | Refused by policy | Relay the reason verbatim and stop. Never restage, split or work around it. |
| 4 | Blocked | Relay the message. Signing: ask the user to plug in or unlock the YubiKey, then retry. Hooks: follow `{baseDir}/../pre-commit-failure/SKILL.md`. Push auth: the driver already retried once. |
| 1 | Harness error | Report it. |

Never run `git add`, `git commit`, `git push` or `--force` yourself for this
task, and never disable signing or hooks. If the driver refuses, the answer is
to tell the user, not to find another way in.

A nested repository with its own pending work is refused by design: commit it
from inside that repository first, then run the driver again in the parent.
