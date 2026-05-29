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
- Library packages: `declaration` + `declarationMap` for IDE nav

## Typecheck Gate
- Run `vp check` (lint + fmt + typecheck) before committing
- `tsc --noEmit` catches what linters cannot
