---
name: domain-interview
description: Interview the user on their understanding of project domain, architecture, and inner workings to surface divergences between their mental model and the codebase. Use when user wants to validate their understanding, audit documentation accuracy, find undocumented behavior, or mentions "domain interview", "divergence check", or "audit understanding".
note_for_the_user: This skill yields best benefit if run with thinking visibility switched off so you answer from your very own mental model and don't get spoiled answers (you can temporaly toggle in on as need be).
---

# Domain Interview

Relentlessly interview the user about every aspect of the project — domain concepts, architecture decisions, internal mechanics, edge cases. The goal is **not** to test them. It is to surface **zones of divergence** between their mental model and what the sources actually say, so you can jointly correct erroneous documentation, specifications, or code — or document what is currently undocumented.

## Sources of Truth (in priority order)

Build your own understanding from these before interviewing:

1. **`./src`** — actual implementation
2. `README.md` — public README
3. **`./docs/adrs`** — architecture decision records
4. **`./docs`** — public-facing documentation (guides, API docs, how-tos)
5. **`./private/openspec`** — detailed author specification (look at all `design.md`, `proposal.md`, and `spec.md` anywhere in the file tree plus any doc directly at L1 of the tree).

Read broadly across all four before starting. Your understanding must span spec, decisions, docs, **and** code.

## Interview Process

1. **Build your model first.** Read all sources. Form a comprehensive internal model of the domain, architecture, data flows, invariants, and edge cases.
2. **Interview one topic at a time.** Pick a domain concept, architectural boundary, data flow, or invariant. Ask the user to explain it in their own words.
3. **Compare silently.** After their answer, compare against your model. Identify:
   - **Alignment** — their understanding matches sources. Move on.
   - **Divergence** — their understanding differs from sources. Surface it explicitly.
   - **Gap** — neither of you can find it documented. Flag it as undocumented.
4. **Resolve each divergence.** For every divergence, determine which is correct:
   - If the **sources are wrong** → propose an edit to the source.
   - If the **user's model is wrong** → show them the evidence from sources.
   - If **both are incomplete** → propose documentation for the gap.
5. **Move systematically.** Cover: ubiquitous language / domain concepts → bounded contexts / module boundaries → data flows & invariants → error handling → edge cases & failure modes → configuration & deployment → anything else.

## Asking Questions

- Ask one question at a time.
- Prefer open-ended: "How does X work?" / "What happens when Y?"
- For concrete concepts, ask for examples: "Can you walk me through what happens when a user does Z?"
- If the user deflects or says "I'm not sure", explore the codebase together rather than moving on.
- Track what you've covered and what remains. Announce transitions between topic areas.

## When You Find Divergence

Surface it directly:

> "I see a divergence here. You described X as [their explanation]. But in [source], it says [actual]. Let's figure out which is correct."

Then work with the user to resolve:

- Is the source wrong and needs updating?
- Is the user's mental model out of date?
- Is this a genuine undocumented area?

## Editing Rules

- **Always get explicit user consent before any edit.** Propose the change, show the diff, wait for approval.
- Never auto-edit documentation, specs, or code as part of this skill.
- When proposing edits, specify the file path and the exact change.
- Group related edits into a single proposal when they address the same divergence.

## Session Output

At the end of the interview (or when the user stops), produce a summary:

1. **Topics covered** — list of areas discussed
2. **Divergences found** — each with: topic, what user said, what sources say, resolution
3. **Gaps identified** — undocumented areas that need documentation
4. **Edits made** — changes the user approved (with file paths)
5. **Open questions** — anything unresolved that needs follow-up

See [REFERENCE.md](REFERENCE.md) for the divergence taxonomy and interview heuristics.
