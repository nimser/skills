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

`--groups-file PATH|-` fixes the caller's groups and exclusions; the selected model
only generates their messages. Add `--dry-run` for text generation without
execution. This is whole-file grouping, not hunk splitting. The advanced workflow
permits carefully preserved patch/stash preparation and, only when necessary,
manual signed commits; it never waives safety gates, signing, hooks or push policy.

Let the driver write messages; never take over for preferred wording or a large
diff. Large evidence uses bounded excerpts and automatic grouping/message passes.
Use `--message-file PATH|-` for one cohesive group with no exclusions, or a reviewed
`--plan-file PATH|-` for a complete plan, only after exhausted model validation.
Both require `--recovery ID` (tool: `messageFile`/`planFile` and `recovery`) with the
receipt returned for `planner-validation-exhausted`. Inspect diagnostics and
explain the recovery first. Receipts bind the repository, HEAD, index, files and
style, expire after 24 hours, and are consumed before execution; `--dry-run`
(tool: `dryRun`) preserves them. Fixed groups and exclusions cannot change.
Policy, resource limits, transport, signing, hook and drift failures never permit
manual-message recovery. The driver appends the attribution trailer.
`plannerDiagnostics` records per-attempt errors in JSON;
report actual failures rather than guessing their cause. For model failures,
read the capture directory named in the run output, or point `--debug-dir`
elsewhere outside the repository; it holds private request/raw-response artifacts
that may contain secrets and expires after 14 days. Never paste those files into
reports without review. Planning uses a 90-second total budget and a 30-second
first-output deadline. The driver permits one fresh timeout retry with reduced
evidence after compatible llama.cpp slot monitoring reports idle twice; an
unverified workload blocks another local request, not the independent Pi fallback.
After a blocked timeout, check active model
work before manually retrying; client cancellation does not prove the server stopped.

Local transport errors, timeouts and exhausted validation retries automatically
switch once to `cpa-openai/gpt-6-luna` with low thinking through Pi's configured
provider credentials. The fallback has its own bounded planning budget and uses
the same validation and commit gates; policy, signing, hook, drift and push
failures never trigger it. This sends the compact repository evidence to that
provider. Use `--no-fallback` (tool: `noFallback: true`) or
`COMMIT_DRIVER_FALLBACK_MODEL=none` for local-only work.

Select another planner with `--model provider/model` (tool: `model`) and optional
`--thinking` (tool: `thinking`, default `low`). An unqualified model ID selects
the local endpoint. Override the fallback with `--fallback-model provider/model`
(tool: `fallbackModel`) or `COMMIT_DRIVER_FALLBACK_MODEL`; automatic fallback
always uses low thinking. Explicit Pi models do not chain to another fallback.
Model selection stays inside the registered commit tool, never a manual commit.
Report `plannerFallback` when used and retain both routes' diagnostics.

The planner groups related whole files into commits and may exclude any
changed file with a reason. Every path must be accounted for exactly once.
Report exclusions and completed commits, including on failure. Excluded files
keep their contents and staging state; isolated commit indexes prevent leaks.
The driver never splits hunks and pushes only after all commits succeed.

On a clean tree, ordinary `--push` uses the `--push-only` checks to publish
existing commits; dry runs and explicit planning options do not use this fallback.
After a blocked push, call the registered `commit` tool with `push: true` and
`pushOnly: true` (no planning options), or run
`bash {baseDir}/commit.sh --push-only`. This explicitly publishes from a clean,
attached branch. The driver verifies that its live upstream has not
moved and refuses dirty, detached, diverged or up-to-date branches. Neither path
creates another commit or invokes the planner.

### Certificate and key files

The driver refuses `.pem`, `.key`, `.crt`, `.p12` and similar files unless each is
declared with `--certificate-declarations PATH|-` (tool: `certificateDeclarations`):
a JSON array of `{path, sha256, assertion}`. Inspect the file first. Declare
`no-private-key` only when it holds no private key data; otherwise tell the user
what it contains and declare `user-approved` only after they explicitly accept the
commit. Declarations are recorded in the commit message. `.env` files and `id_*`
SSH keys stay refused.

## Reading the result

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Completed, dry run, or all files excluded | Report commits and every exclusion; all-excluded plans do not push. |
| 3 | Refused by policy | Relay the reason and stop; never bypass the gate. |
| 4 | Blocked | Report completed commits and the blocker; do not reset or retry blindly. |
| 1 | Harness error | Report it. |

Outside the documented session override, never run `git add`, `git commit` or
`git push` yourself for this task. Never force-push, disable signing or hooks,
or work around a policy refusal. The override must verify restoration before
pushing; partial completion is not permission to publish.

A nested repository with its own pending work is refused by design: commit it
from inside that repository first, then run the driver again in the parent.
