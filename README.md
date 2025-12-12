> [!Caution]
> **MIRROR NOTICE**
>
> This repository is a filtered mirror of a private source, published for reference only.
> It contains only the paths its allowlist names, so it is not a complete project.
>
> *Standard upgrade paths MIGHT be compromised!*

# pi-skills

A collection of skills for [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent), compatible with Claude Code and Codex CLI.

## Installation

### pi-coding-agent

pi supports recursive skill discovery, so clone the entire repo:

```bash
# User-level (available in all projects)
git clone https://github.com/badlogic/pi-skills ~/.pi/agent/skills/pi-skills

# Or project-level
git clone https://github.com/badlogic/pi-skills .pi/skills/pi-skills
```

### Codex CLI

Codex also supports recursive skill discovery:

```bash
git clone https://github.com/badlogic/pi-skills ~/.codex/skills/pi-skills
```

### Claude Code

Claude Code only looks one level deep for `SKILL.md` files, so each skill folder must be directly under the skills directory. Clone the repo somewhere, then symlink individual skills:

```bash
# Clone to a convenient location
git clone https://github.com/badlogic/pi-skills ~/pi-skills

# Symlink individual skills (user-level)
mkdir -p ~/.claude/skills
ln -s ~/pi-skills/brave-search ~/.claude/skills/brave-search
ln -s ~/pi-skills/browser-tools ~/.claude/skills/browser-tools
ln -s ~/pi-skills/gccli ~/.claude/skills/gccli
ln -s ~/pi-skills/gdcli ~/.claude/skills/gdcli
ln -s ~/pi-skills/gmcli ~/.claude/skills/gmcli
ln -s ~/pi-skills/vscode ~/.claude/skills/vscode

# Or project-level
mkdir -p .claude/skills
ln -s ~/pi-skills/brave-search .claude/skills/brave-search
ln -s ~/pi-skills/browser-tools .claude/skills/browser-tools
ln -s ~/pi-skills/gccli .claude/skills/gccli
ln -s ~/pi-skills/gdcli .claude/skills/gdcli
ln -s ~/pi-skills/gmcli .claude/skills/gmcli
ln -s ~/pi-skills/vscode .claude/skills/vscode
```

## Available Skills

| Skill | Description |
|-------|-------------|
| [brave-search](brave-search/SKILL.md) | Web search and content extraction via Brave Search |
| [browser-tools](browser-tools/SKILL.md) | Interactive browser automation via Chrome DevTools Protocol |
| [gccli](gccli/SKILL.md) | Google Calendar CLI for events and availability |
| [gdcli](gdcli/SKILL.md) | Google Drive CLI for file management and sharing |
| [gmcli](gmcli/SKILL.md) | Gmail CLI for email, drafts, and labels |
| [vscode](vscode/SKILL.md) | VS Code integration for diffs and file comparison |

## Skill Format

Each skill follows the pi/Claude Code format:

```markdown
---
name: skill-name
description: Short description shown to agent
---

# Instructions

Detailed instructions here...
Helper files available at: {baseDir}/
```

The `{baseDir}` placeholder is replaced with the skill's directory path at runtime.

## Requirements

Some skills require additional setup:

- **brave-search**: Requires Node.js. Run `npm install` in the skill directory.
- **browser-tools**: Requires Chrome and Node.js. Run `npm install` in the skill directory.
- **gccli**: Requires Node.js. Install globally with `npm install -g @mariozechner/gccli`.
- **gdcli**: Requires Node.js. Install globally with `npm install -g @mariozechner/gdcli`.
- **gmcli**: Requires Node.js. Install globally with `npm install -g @mariozechner/gmcli`.
- **vscode**: Requires VS Code with `code` CLI in PATH.

## License

MIT
