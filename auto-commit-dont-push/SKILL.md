---
name: auto-commit-dont-push
description: ALWAYS load this skill when any file under the current repo is changed. Configures the workspace for automatic local commits without ever pushing. Alternative to auto-commit-and-push for projects where remote pushes should stay manual.
---

# Auto Commit, Don't Push

Use this skill when you want the agent to automatically commit changes locally, but **never push** without explicit user instruction.

This is the manual-push alternative to `auto-commit-and-push`. Swap between them depending on project needs.

## Execution Steps

When invoked, execute the following steps in order using your Bash tool:

### 1. Update Agent Instructions
Find the active agent instruction file (usually `.opencode/agent/<agent-name>.md` or `AGENTS.md`) and use your Edit tool to append the following ritual to its system prompt.

If expressive formatting is acceptable in this repo, load and follow the `commit-style` skill for message style. Otherwise, strictly follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) without extra symbols or emoji rules.

```markdown
**Auto-Commit Ritual:**
Whenever you complete a significant task, update state, or modify files, you MUST commit the state locally. NEVER push without explicit instruction from the user.

**Commit Message Format:**
- Strictly follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`, with an allowed type such as `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`.
- If a `commit-style*` skill is loaded, also follow its guidance for scope choice, expressive characters, and commit bodies.
- If no `commit-style*` skill is loaded, keep messages strictly conventional and avoid extra expressive formatting.
- ALWAYS include a `Co-authored-by: Claude <noreply@anthropic.com>` trailer in every commit.

```bash
git add -A && git commit -m "type(scope): description" -m "Co-authored-by: Claude <noreply@anthropic.com>"
```

**Push Safety:**
- NEVER push automatically. Always wait for explicit user instruction.
- When the user asks to push, confirm the branch and remote before proceeding.
```

Inform the user once the configuration is complete and the instructions are updated!
