---
name: commit-style-fun
description: ALWAYS load when committing, staging, amending, or pushing. Opinionated fun/playful Conventional Commits style — emoji, ✦ bullets, mandatory Co-authored-by trailer.
---

# Commit Style (Fun)

Defines message style only (works for manual or automated commits). Vibe: fun, light, scannable — a human wrote this, not a changelog generator.

## Rules (every commit)

- Format: `type(scope): <emoji> description` — strictly [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) types (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`)
- Scope: meaningful repo-local scope (package/app/feature/module), e.g. `feat(auth):`
- Emoji immediately after `:`, contextually relevant (🌐 browser, 🔧 fix, ⚙️ config, 🤖 agent), from expressive Unicode blocks (U+1F300–1F9FF, U+1FA70–1FAFF, U+2600–27BF, etc.)
- Description: playful verbs, casual phrasing — no dry corporate tone
- Body required for non-trivial (multi-change) commits, using `✦` bullets (never `-`); single-line only for trivial single-change commits
- **Always** end with `Co-authored-by: Claude <noreply@anthropic.com>` — non-negotiable, even for single-line commits (AI-attribution transparency)

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
