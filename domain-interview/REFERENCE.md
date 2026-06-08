# Domain Interview — Reference

## Divergence Taxonomy

When you compare the user's explanation against the sources, classify the finding:

| Type | Meaning | Action |
|------|---------|--------|
| **Alignment** | User's model matches sources | No action — move on |
| **Spec Drift** | Code diverged from spec/ADRs | Propose code fix or spec update |
| **Doc Rot** | Documentation outdated vs code/spec | Propose doc update |
| **User Drift** | User's mental model outdated | Show evidence, educate |
| **Shared Gap** | Nothing documents this behavior | Propose new documentation |
| **Naming Conflict** | User and sources use different terms for same concept | Reconcile against ubiquitous language |
| **Hidden Invariant** | Constraint exists in code but nowhere in docs/spec | Propose documenting it |
| **Phantom Concept** | User describes something that doesn't exist in code | Clarify: planned feature? Removed? Misremembered? |

## Interview Heuristics

### Good opening questions

- "Walk me through what this project does at the highest level."
- "What's the core domain concept everything revolves around?"
- "How would you describe the architecture to a new contributor?"

### Drilling deeper

- "What invariants must always hold for [concept]?"
- "What happens when [failure scenario]?"
- "Is there any configuration that changes behavior? What knobs exist?"
- "Where does [module A] end and [module B] begin? What's the boundary?"

### Probing edge cases

- "What's the failure mode when [external dependency] is down?"
- "Can [concept] be in an invalid state? How?"
- "What gets logged/observed when [error] occurs?"

### Probing undocumented areas

- "How is [feature] tested? What scenarios are covered?"
- "Is there anything about [area] that you know but couldn't find documented?"
- "Has [behavior] changed recently? Is the spec still accurate?"

## Coverage Checklist

Track which areas have been interviewed:

- [ ] Ubiquitous language / core domain concepts
- [ ] Bounded contexts / module boundaries
- [ ] Data flows and transformations
- [ ] Domain invariants and business rules
- [ ] Error handling and failure modes
- [ ] Configuration and environment variables
- [ ] External integrations and contracts
- [ ] Testing strategy and coverage gaps
- [ ] Deployment / operational concerns
- [ ] Future plans vs current implementation

## Edit Proposal Format

When proposing an edit to the user:

```
**File:** `./docs/adrs/0005-some-decision.md`
**Change:** Update the consequence section to reflect that [X] actually works as [Y], because [evidence from code].

Proposed diff:
-[old text]
+[new text]

Consent to apply this change?
```

Never apply without explicit "yes", "go ahead", "approved", or equivalent.
