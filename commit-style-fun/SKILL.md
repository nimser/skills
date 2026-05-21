---
name: commit-style-fun
description: ALWAYS load this skill when the user asks to commit, stage, amend, or push changes. Provides an opinionated commit-message style on top of Conventional Commits with expressive Unicode character guidance, scoping conventions, and rules for commit bodies on non-trivial changes.
---

# Commit Style (Fun)

Use this skill when you need an opinionated commit-message style that still follows Conventional Commits.

This skill is intentionally separated from automation. Whether commits are manual or automated, this skill only defines message style.

The vibe: fun, light, and scannable. Commit messages should feel like a human wrote them, not a changelog generator.

## Non-negotiable checklist (every commit)

- [ ] Emoji after `:`
- [ ] `✦` bullets, never `-`
- [ ] Playful tone — no corporate changelog speak
- [ ] Body if non-trivial
- [ ] Co-author trailer: `Co-authored-by: Claude <noreply@anthropic.com>`

## Co-author trailer

Every commit must end with:

```
Co-authored-by: Claude <noreply@anthropic.com>
```

This signals that the commit was co-authored by an AI agent. It provides
transparency about AI involvement, maintains attribution hygiene, and ensures
the repo history distinguishes human-initiated changes from agent-generated
ones. This is non-negotiable — even for single-line commits.

## Rules

- Strictly follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`
- Allowed `type` values: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Prefer meaningful repo-local scopes when applicable: package, app, feature, domain, service, or module names such as `feat(auth):`, `fix(api):`, `docs(readme):`
- Put a relevant expressive character immediately after `:`. Use Unicode blocks U+1F300–1F5FF, U+1F600–1F64F, U+1F680–1F6FF, U+1F900–1F9FF, U+1FA70–1FAFF, U+2600–26FF, U+2700–27BF, or similar expressive characters
- Choose contextually relevant characters when possible (e.g., 🌐 browser, 🔧 fix, ⚙️ config, 🤖 agent)
- Short description: keep it light and fun — playful verbs, casual phrasing, personality welcome. Avoid dry corporate tone.
- Body: use ✦ for bullet points instead of `-`. Sprinkle expressive characters where they add clarity or reduce length.
- For non-trivial commits (more than one change), include a body that clearly lists or explains the changes
- Single-line commits are only acceptable for trivial, single-change commits

## Examples

```
feat(auth): 🔒 let people in with the fancy login

✦ Add OAuth callback route
✦ Persist provider tokens securely
✦ Handle expired session refresh

Co-authored-by: Claude <noreply@anthropic.com>
```

```
fix(api): 🧯 kick out the duplicate payment gremlins

✦ Add idempotency key support
✦ Reject repeated transaction IDs within the retry window

Co-authored-by: Claude <noreply@anthropic.com>
```

```
docs(readme): 📝 unfumble the setup guide so future-me doesn't cry

✦ Document required environment variables
✦ Add troubleshooting steps for first-run failures

Co-authored-by: Claude <noreply@anthropic.com>
```

```
refactor(core): 🧹 yeet the legacy config mess

✦ Extract validation into its own module
✦ Drop unused legacy parsers
✦ Simplify error propagation

Co-authored-by: Claude <noreply@anthropic.com>
```

```
fix(ui): 🩹 patch the button that does nothing when clicked

✦ Wire up the missing onClick handler
✦ Add loading spinner so users stop rage-clicking

Co-authored-by: Claude <noreply@anthropic.com>
```

```
feat(search): 🔍 make search actually find things

✦ Index document content for full-text search
✦ Add fuzzy matching for typo tolerance
✦ Show result highlights so eyes don't bleed

Co-authored-by: Claude <noreply@anthropic.com>
```
