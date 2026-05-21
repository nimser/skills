---
name: auto-commit-dont-push
description: ALWAYS load this skill when you complete a significant task, update state, or modify files under the current repo. Configures the workspace for automatic local commits without ever pushing.
---

# Auto Commit, Don't Push

Use this skill when you want the agent to automatically commit changes locally, but **never push** without explicit user instruction.

This is the manual-push alternative to `auto-commit-and-push`. Swap between them depending on project needs.

## Execution Steps

When invoked, execute the following steps in order using your Bash tool:

### 1. Perform the following commit ritual

**Push Safety:**

- NEVER push automatically. Always wait for explicit user instruction.
- When the user asks to push, confirm the branch and remote before proceeding.

**Auto-Commit Ritual:**

Whenever you complete a significant task, update state, or modify files, you MUST execute the following sequence of tasks in order to save the state locally with a suitable commit message. NEVER push without explicit instruction from the user.

Tasks sequence:

1. [ ] IMPORTANT: To get the proper `<compliant message>` commit message, load and strictly follow the instructions from the `commit-style-fun`, `commit-style-default`, or any available `commit-style*` skill for message style.
2. [ ] run `git add -A && git commit -m "<compliant message>"` replacing the message based on previous step.
