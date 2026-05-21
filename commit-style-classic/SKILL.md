---
name: commit-style-classic
description: ALWAYS load this skill when the user asks to commit, stage, amend, or push changes. Provides a clean, professional commit-message style following Conventional Commits with no emoji, no expressive symbols, and no playful tone.
---

# Commit Style (Classic)

Use this skill when you need a clean, professional commit-message style that strictly follows Conventional Commits.

This skill is intentionally separated from automation. Whether commits are manual or automated, this skill only defines message style.

The vibe: clear, concise, and professional. Commit messages should be readable and informative without decorative elements.

## Non-negotiable checklist (every commit)

- [ ] No emoji or expressive characters
- [ ] Standard markdown bullets (`-`) in body
- [ ] Professional, neutral tone
- [ ] Body if non-trivial
- [ ] Co-author trailer: `Co-authored-by: Claude <noreply@anthropic.com>`

## Rules

- Strictly follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`
- Allowed `type` values: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Prefer meaningful repo-local scopes when applicable: package, app, feature, domain, service, or module names such as `feat(auth):`, `fix(api):`, `docs(readme):`
- Short description: keep it clear and direct. Use standard technical language.
- Body: use standard markdown bullets (`-`) for listing changes.
- For non-trivial commits (more than one change), include a body that clearly lists or explains the changes
- Single-line commits are only acceptable for trivial, single-change commits

## Examples

```
feat(auth): add OAuth callback route

- Add OAuth callback route
- Persist provider tokens securely
- Handle expired session refresh
```

```
fix(api): add idempotency key support

- Add idempotency key support
- Reject repeated transaction IDs within the retry window
```

```
docs(readme): document required environment variables

- Document required environment variables
- Add troubleshooting steps for first-run failures
```

```
refactor(core): extract validation into its own module

- Extract validation into its own module
- Drop unused legacy parsers
- Simplify error propagation
```

```
fix(ui): wire up the missing onClick handler

- Wire up the missing onClick handler
- Add loading spinner for better UX
```

```
feat(search): add full-text search indexing

- Index document content for full-text search
- Add fuzzy matching for typo tolerance
- Show result highlights
```
