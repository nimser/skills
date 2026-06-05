---
name: code-style
description: Enforce consistent TypeScript/JavaScript coding conventions across repos. Use when writing, editing, or reviewing code, or when user mentions formatting, naming, types, imports, exports, or comments.
---

# Code Style

Apply these conventions to every TypeScript/JavaScript file.

## Naming
- `PascalCase` — types, interfaces, enums, classes, React components
- `camelCase` — variables, functions, properties, methods
- `UPPER_SNAKE_CASE` — constants from literal values
- `#private` — truly private fields (not TS `private` keyword)
- `T` prefix — generic type parameters (`TInput`, `TContext`)
- **No `I` prefix** for interfaces

## Comments — Very Sparse
- **Only**: non-trivial logic, external references, security notes, documented trade-offs, TODO/BUG markers
- **Never**: explain what obvious code does
- JSDoc on public package exports only — never internal glue code
- Architectural decisions belong in `docs/adr/`, not inline

## Types
- `no-explicit-any` is an **error** — use generics, `unknown`, or better types
- Prefer `satisfies` over `as` — narrows without widening
- No `!` non-null assertions — narrow or use `?.`
- Prefer `undefined` over `null`
- Discriminated unions for exhaustive branching
- `noUncheckedIndexedAccess` means `arr[0]` is `T | undefined` — always handle

## Imports & Exports
- Named exports only — **no default exports**
- No `export *` barrel re-exports at domain boundaries
- Group: node built-ins → npm packages → workspace → relative
- Sort alphabetically within groups
- Keep `index.ts` to re-exports only — no implementation
- File named after its primary export

## Error Handling
- Zod schema validation at all boundaries (env, requests, config)
- Throw on unexpected failures — don't silently swallow
- Use typed error classes for distinguishable failure modes
- `no-console` is a lint error — structured logging in production code

## File Structure
- Colocate tests: `file.test.ts` next to `file.ts`
- Colocate types alongside their implementation
- Shared boundary types in `types.ts`

## Formatting (Oxfmt)
- Single quotes · no semicolons · trailing commas es5
- printWidth: 100 · tabWidth: 2 · spaces · max line len 100
- Let the formatter own whitespace — never manually align
- Markdown: dprint (wrap: maintain, lineWidth: 10000)

## Package Exports
- Explicit `exports` in `package.json` (types + import entries)
- Subpath exports fine, but always explicit — no accidental surface leaks
- Library packages: separate `tsconfig.build.json` with `declaration` + `declarationMap`

## Scripts (run via package manager)

These scripts are set up by `code-style/init.sh` and installed as devDependencies (`oxlint`, `oxfmt`, `dprint`, `typescript`, `oxlint-tsgolint`).

> **Note:** `oxlint-tsgolint` is required for `--type-aware` linting. It is automatically installed when lint scripts use `--type-aware`.

| Script           | Command                                              | Purpose                            |
| ---------------- | ---------------------------------------------------- | ---------------------------------- |
| `lint`           | `oxlint --type-aware .`                              | Check for lint issues (type-aware) |
| `lint:fix`       | `oxlint --type-aware --fix .`                        | Auto-fix fixable lint issues       |
| `format`         | `oxfmt . && dprint fmt`                              | Format code and markdown in place  |
| `format:check`   | `oxfmt --check . && dprint check`                    | CI / verify formatting is clean    |
| `typecheck`      | `tsc --noEmit`                                       | Type-check only                    |
| `check`          | `oxlint --type-aware . && oxfmt --check . && dprint check && tsc --noEmit` | Full gate (lint + format + typecheck) |

### Pre-commit hook

`code-style/init.sh` installs a `.git/hooks/pre-commit` hook that runs **`format`** then **`check`** before every commit. Formatting is applied automatically; lint and typecheck must pass for the commit to proceed.

- **Bypass** (escape hatch): `git commit --no-verify`
- The hook is interactive during `init.sh` — it asks on existing projects, auto-installs on nimser repos and fresh projects
- If a non-code-style pre-commit hook already exists, it is preserved (never overwritten)

### Local overrides

Create a `.code-style.local` file in your project root to persistently customize behavior. This file is **never overwritten** by `init.sh` and is automatically added to `.git/info/exclude` (local-only, not tracked in the repo).

**Supported directives:**

- `ignore_file` — skip merging a specific config file entirely
- `ignore_script` — skip setting a specific script in package.json
- `ignore_dep` — skip installing a specific dependency
- `override` — apply jq expressions to modify a config after merging
- `override_script` — override a script's command (use `|` as delimiter since `:` appears in script names)

**Example: completely avoid dprint**

```bash
# .code-style.local

# Don't create local dprint config
ignore_file = .dprint.json

# Don't install dprint dependency
ignore_dep = dprint

# Override scripts that reference dprint to use oxfmt only
override_script = format|oxfmt .
override_script = format:check|oxfmt --check .
override_script = check|oxlint --type-aware . && oxfmt --check . && tsc --noEmit
```

**Other examples:**

```bash
# Override specific config settings after merge
override = .oxfmtrc.json:{"printWidth": 120}
override = .oxlintrc.json:{"rules": {"no-console": "warn"}}

# Skip tsconfig entirely
ignore_file = tsconfig.json

# Skip lint scripts
ignore_script = lint
ignore_script = lint:fix
```

The override values are applied using jq's recursive merge (`*` operator), so you can selectively revert specific keys without losing the rest of the skill's config.

### Agent workflow

Just commit — the hook runs `format` (auto-fix) and `check` (lint + format-verify + typecheck) as a gate. If it fails, fix the reported issues and commit again.

### When to use `lint:fix`

`lint:fix` applies automatic fixes that can change code semantics (renaming variables, removing unused imports, rewriting expressions). **Always review the diff** after running it — don't run it blindly before committing. Use it when:

- You want to see what the linter would auto-fix
- You've introduced a batch of lint issues and want to fix the safe ones in bulk
- You're exploring what a rule violation looks like when auto-corrected

After `lint:fix`, review the changes, then commit as normal (the hook will run format + check).
