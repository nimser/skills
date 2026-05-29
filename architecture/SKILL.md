---
name: architecture
description: Guide architectural decisions for TypeScript apps using DDD, Clean Architecture, ADRs, and domain vocabulary. Use when designing features, new packages, refactors, or when user mentions architecture, domain, bounded contexts, or ADRs.
---

# Architecture

Follow these principles when designing features, packages, or refactoring.

## DDD / Clean Architecture

- **Boundaries**: packages represent bounded contexts
- **Dependency direction**: domain → application → infrastructure (never the reverse)
- Domains know nothing about Express, HTTP, databases, or framework details
- Use cases and features live in the application layer, not leaked into domain
- Dependency inversion at all package boundaries

## Error Handling Patterns
- Zod schema validation at **every boundary**: env variables, request input, configuration
- Throw on unexpected failures — never silent `console.error` or swallowed errors
- Use typed error classes (extend `Error`) for distinguishable failure modes
- Propagated errors should be type-safe at API boundaries

## File Structure for Architecture
- Colocate tests: `file.test.ts` next to `file.ts`
- Colocate types alongside implementation
- Shared boundary types go in `types.ts`
- Keep `index.ts` free from implementation

## ADRs (Architecture Decision Records)
- Document significant architectural decisions in `docs/adr/NNNN-title.md`
- ADR format: Context → Decision → Consequences
- Flag ADR conflicts explicitly — don't silently override:
  > _Contradicts ADR-0002 — but worth reopening because…_

## Domain Vocabulary (`CONTEXT.md`)
- Define domain concepts in `CONTEXT.md` at repo root
- Include an **"Avoid:"** column for synonyms the project does **not** use
- Use glossary vocabulary consistently across issues, code, and tests
- If a concept isn't in the glossary, it's either invented language (reconsider) or a real gap (note for `/grill-with-docs`)
- Don't flag absence — create lazily when terms get resolved

## Package Discipline
- Explicit `exports` in `package.json` — types + import entries per subpath
- No `export *` — explicit public surface only
- Library packages: `declaration` + `declarationMap`
- Changes to public behavior require a **changeset entry**

## Workflow
- **ALWAYS use the `tdd` skill** when starting a feature or task
- Run `vp check` before committing
- When changing public-facing behavior, update documentation
- New packages require `package.json`, `tsconfig.json`, test colocations
