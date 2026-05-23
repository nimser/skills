> [!Caution]
> **MIRROR NOTICE**
>
> This repository is a filtered mirror of a private source, published for reference only.
> It contains only the paths its allowlist names, so it is not a complete project.
>
> *Standard upgrade paths MIGHT be compromised!*

# skills

A growing collection of skills for coding agents — compatible with [opencode](https://opencode.ai), Claude Code, Codex CLI, and others.

These skills are opinionated workflow helpers. They're small, composable, and designed to be hacked on. Take what works, toss what doesn't, make them yours.

## Available Skills

### Git & Commit Workflows

| Skill | Description |
|-------|-------------|
| [auto-commit-and-push](.agents/skills/auto-commit-and-push/SKILL.md) | Non-interactive git commits and pushes using a deploy key, bypassing YubiKey/FIDO2 touch prompts |
| [auto-commit-dont-push](auto-commit-dont-push/SKILL.md) | Auto-commit without pushing — for when you want local-only saves |
| [commit-style-fun](.agents/skills/commit-style-fun/SKILL.md) | Opinionated Conventional Commits style with expressive Unicode characters and playful tone |
| [commit-style-classic](commit-style-classic/SKILL.md) | Classic Conventional Commits style — no frills |

### Web & Browser

| Skill | Description |
|-------|-------------|
| [brave-search](.agents/skills/brave-search/SKILL.md) | Web search and content extraction via Brave Search API — lightweight, no browser required |
| [browser-tools](.agents/skills/browser-tools/SKILL.md) | Interactive browser automation via Chrome DevTools Protocol |
| [youtube-transcript](youtube-transcript/SKILL.md) | Fetch YouTube video transcripts |

### Google Workspace

| Skill | Description |
|-------|-------------|
| [gccli](gccli/SKILL.md) | Google Calendar CLI for events and availability |
| [gdcli](gdcli/SKILL.md) | Google Drive CLI for file management and sharing |
| [gmcli](gmcli/SKILL.md) | Gmail CLI for email, drafts, and labels |

### Utilities

| Skill | Description |
|-------|-------------|
| [transcribe](transcribe/SKILL.md) | Speech-to-text transcription via Groq Whisper API |
| [vscode](vscode/SKILL.md) | VS Code integration for diffs and file comparison |

## Installation

### opencode

Skills in `.agents/skills/` are automatically discovered. For root-level skills, symlink them:

```bash
ln -s /path/to/repo/gccli ~/.opencode/skills/gccli
```

### Claude Code

Claude Code looks one level deep for `SKILL.md` files. Clone the repo, then symlink individual skills:

```bash
git clone https://github.com/nimser/skills ~/skills

mkdir -p ~/.claude/skills
ln -s ~/skills/brave-search ~/.claude/skills/brave-search
ln -s ~/skills/browser-tools ~/.claude/skills/browser-tools
# ... add whichever skills you want
```

### Codex CLI

```bash
git clone https://github.com/nimser/skills ~/.codex/skills/skills
```

## Requirements

Some skills need extra setup. The agent will usually walk you through it, but:

- **brave-search** — Node.js. Run `npm install` in the skill directory. Requires a free Brave Search API key.
- **browser-tools** — Chrome and Node.js. Run `npm install` in the skill directory.
- **gccli / gdcli / gmcli** — Node.js. Install globally with `npm install -g @mariozechner/gccli` (etc.).
- **transcribe** — `curl` and a Groq API key.
- **vscode** — VS Code with `code` CLI in PATH.
- **youtube-transcript** — Node.js. Run `npm install` in the skill directory.

## Skill Format

Each skill is a directory containing a `SKILL.md` with frontmatter:

```markdown
---
name: skill-name
description: Short description shown to the agent
---

# Instructions

Detailed instructions here...
Helper files available at: {baseDir}/
```

The `{baseDir}` placeholder is replaced with the skill's directory path at runtime.

## Acknowledgements

Inspired by and drawing from:

- [mattpocock/skills](https://github.com/mattpocock/skills) — Skills for real engineers. Excellent collection of productivity and engineering workflow skills.
- [badlogic/pi-skills](https://github.com/badlogic/pi-skills) — Original skill collection for pi-coding-agent. Many of the utility skills (brave-search, browser-tools, google CLIs, etc.) originated here.

## License

MIT
