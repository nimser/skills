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
- Short description: keep it clear and direct. Use standard technical language.
- Body: use standard markdown bullets (`-`) for listing changes.
- For non-trivial commits (more than one change), include a body that clearly lists or explains the changes
- Single-line commits are only acceptable for trivial, single-change commits

## Example

```
feat(auth): add OAuth callback route

- Add OAuth callback route
- Persist provider tokens securely
- Handle expired session refresh

Co-authored-by: Claude <noreply@anthropic.com>
```

```
```
