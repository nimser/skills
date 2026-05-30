---
name: pre-commit-failure
description: Pre-commit hook failure recovery protocol. Read ONLY when a git commit is rejected by pre-commit hooks (linting, formatting, type-checking).
---

# Commit Hooks — Failure Recovery

## Never Do These

- Modify linting/formatting config (`.eslintrc`, `biome.json`, `pyproject.toml` lint sections, etc.)
- Use `--no-verify` or `-n` on `git commit`
- Disable or bypass git hooks (`.husky/*`, `.git/hooks/*`)
- Add inline suppressions (`// eslint-disable`, `# noqa`, `# type: ignore`) unless the user explicitly asks

The hooks define the quality bar. Meet it, don't lower it.

## What To Do Instead

**Trivial fixes** (formatting, import order, whitespace, auto-fixable issues, obvious type annotations) — fix them yourself and re-attempt the commit. No need to report.

**Non-trivial fixes** (type errors needing business-logic understanding, unused variables that might be intentional, logic errors, security warnings, anything with multiple valid solutions) — fix what you can, then tell the user: what failed, what you changed and how, what you think still needs attention. **Do not re-attempt the commit.** Ask first.

**Mixed** — fix the trivial stuff, report the rest, ask before re-committing.
