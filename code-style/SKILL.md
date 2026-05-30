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
- Discriminated unions for exhaustive branching **and domain rules** — use the variant to make invalid states unrepresentable (e.g., a `kind: 'readonly'` variant only permits safe operations, not mutating ones; the illegal combo is a compile error, not a runtime check)
- `noUncheckedIndexedAccess` means `arr[0]` is `T | undefined` — always handle
- **Validators and parsers accept `unknown`, return type guards** — never accept the type a validator is validating; that's a lie about its job, and it lets untyped input crash through. Always `function parse(x: unknown): x is Rule`, never `function validate(rule: Rule): Result`
- **Layer constraints at the highest expressing layer:** make invalid states unrepresentable before reaching for runtime checks
  1. **Types** — discriminated unions and narrowed variants encode *domain rules* at compile time
  2. **Type guards** — narrow `unknown` input structurally; the type system *forces* every defensive check to exist
  3. **Runtime checks** — only invariants types cannot express (duplicate IDs, cross-record uniqueness, temporal constraints)

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
