---
name: prepare-library
description: Set up a TypeScript library repo for public release. Covers metadata, docs, CI, templates, and Typedoc needed before shipping. Use when creating a new library project, preparing a first release, or auditing an existing repo for publish readiness.
disable-model-invocation: true
---

# Prepare Library

Sets up a TypeScript library repo for public release. Opinionated defaults from the `agent-guardrails` project.

## What code-style already handles

The `code-style` skill's `init.sh` covers: `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.dprint.json`, npm scripts (lint, format, check, typecheck), and the pre-commit hook. **Skip those.** This skill covers everything else.

## Phase 1: package.json metadata

Required fields beyond what code-style sets:

- **`version`**: Use `-dev` suffix while pre-release (e.g. `"0.1.0-dev"`)
- **`author`**: Your name
- **`repository`**: `{ type: "git", url: "<repo-url>" }`
- **`bugs`**: `{ url: "<issues-url>" }`
- **`engines`**: `{ node: ">=<current-major>.0.0" }` — don't guess, check `node -v`
- **`files`**: `["dist"]` — whitelist only the build output
- **`exports`**: explicit types + import for each subpath

## Phase 2: root files

| File | Why |
|---|---|
| `LICENSE` | Must match `license` field. Standard MIT text with copyright holder + year. |
| `README.md` | Security disclaimer first (if applicable), badges, one-line pitch, features, quick start, docs links, contributing CTA. Under 200 lines. |
| `CONTRIBUTING.md` | Setup, scripts table, contribution paths ranked by effort (lowest barrier first), PR guidelines, security pointer. |
| `SECURITY.md` | Required if security-adjacent: scope limits, reporting process, response timeline, known bypass vectors. |
| `CHANGELOG.md` | Keep a Changelog format. Start with `## [Unreleased]` even if empty. |
| `.npmignore` | Defense-in-depth for `files`. Exclude: `.devcontainer/`, `.agents/`, `.pi/`, `.opencode/`, `openspec/`, `research/`, `src/`, `.git/`, `.github/`, config files, `vitest.config.ts`. |

## Phase 3: tsconfig.build.json

The build config — separate from dev `tsconfig.json`. Must set `noEmit: false`, proper `outDir`/`rootDir`. Exclude **both** `.test.ts` and `.spec.ts` (the dev config may only cover one).

## Phase 4: CI — `.github/workflows/ci.yml`

Three parallel jobs on push/PR to main:

1. **check** — lint + format:check + typecheck
2. **test** — `npm test -- --coverage` + codecov upload (`fail_ci_if_error: false` until token configured)
3. **build** — compile + `npm pack --dry-run` (catches accidental file inclusions before they ship)

Use `actions/setup-node@v4` with `node-version: 22` and `cache: npm` in all jobs.

## Phase 5: issue + PR templates

**Bug report**: what happened, expected, version, environment/harness, reproduction steps, logs.

**Feature request**: contribution type dropdown (config, adapter, engine, docs, chore), description, example, alternatives.

**PR template** must include:
- Contribution type checklist
- **AI Assist Disclosure**: model used + agentic flow (None / Advice-only / HITL / AFK)
- Standard checklist (tests, lint, JSDoc, changelog)

## Phase 6: Typedoc

Create `typedoc.json` — entry: `src/index.ts`, output: `docs/api`, exclude private/internal, include version.

Add scripts: `"docs": "typedoc"`, `"docs:check": "typedoc --emit none"`.

Add `docs/api/` to `.gitignore`.

## Phase 7: JSDoc on public exports

The barrel file (`src/index.ts`) is the public API. Add one-line JSDoc on every re-export:

```typescript
export type {
  /** One-line: what this type does. */
  MyType,
} from './core/types.js'
```

JSDoc on public exports only — never internal glue. Typedoc will warn about referenced-but-unexported types; export them to fix.

## Execution checklist

- [ ] `package.json` — version, author, repository, bugs, engines, files, exports
- [ ] `LICENSE` matches package.json
- [ ] `README.md` — disclaimer, pitch, features, quick start, docs links
- [ ] `CONTRIBUTING.md` — setup, effort-ranked paths, PR guidelines
- [ ] `SECURITY.md` — scope, reporting, limitations
- [ ] `CHANGELOG.md` — Keep a Changelog, unreleased section
- [ ] `.npmignore` — excludes dev/tooling dirs
- [ ] `tsconfig.build.json` — noEmit false, both test + spec excluded
- [ ] `.github/workflows/ci.yml` — check, test, build jobs
- [ ] `.github/ISSUE_TEMPLATE/` — bug report + feature request
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` — AI disclosure + type checklist
- [ ] `typedoc.json` + docs scripts
- [ ] `npm run docs` — zero warnings
- [ ] JSDoc on all `src/index.ts` exports
- [ ] `npm run check` / `npm test` / `npm run build` all pass
- [ ] `npm pack --dry-run` shows clean tarball
