> [!Caution]
> **MIRROR NOTICE**
>
> This repository is a filtered mirror of a private source, published for reference only.
> It contains only the paths its allowlist names, so it is not a complete project.
>
> *Standard upgrade paths MIGHT be compromised!*

# skills

A growing collection of skills for coding agents — compatible with [opencode](https://opencode.ai) and Claude Code.

These skills are opinionated workflow helpers. They're small, composable, and designed to be hacked on. Take what works, toss what doesn't, make them yours.

## Skills

```
Git & Commit Workflows
├── auto-commit-and-push            # touchless git push via deploy key
├── auto-commit-dont-push           # local-only auto-commit
├── commit-style-fun                 # playful Conventional Commits style
└── commit-style-classic             # no-frills Conventional Commits

Web & Browser
├── brave-search                    # web search via Brave API
├── browser-tools                   # Chrome DevTools Protocol automation
└── youtube-transcript              # YouTube transcript fetcher

Google Workspace
├── gccli                           # Google Calendar CLI
├── gdcli                           # Google Drive CLI
└── gmcli                           # Gmail CLI

Data
└── teable                          # Teable bases: typed fields, kanban views, records

Utilities
├── transcribe                      # speech-to-text via Groq Whisper
└── vscode                          # VS Code diffs & file comparison
```

## Init Architecture

Each skill directory can contain an `init.sh` script that bootstraps the
skill's environment — generating keys, registering deploy keys on GitHub,
configuring git, installing deps, etc.

```
some-skill/
├── SKILL.md          # instructions loaded by the agent
├── init.sh           # one-shot setup script (idempotent)
└── ...               # helper scripts, configs, etc.
```

`init.sh` scripts can be automatically executed at agent startup time via a
wrapper script or via agent plugins (e.g. an opencode plugin), so the agent
arrives in a ready-to-work state without manual intervention.

## Installation

Both opencode and Claude Code discover skills from `.agents/skills/`.

To preserve context window, avoid installing skills globally. Instead, clone
this repo once and symlink the skills you need into each project:

```bash
git clone https://github.com/nimser/skills ~/skills

# per project
cd your-project
ln -s ~/skills/brave-search .agents/skills/brave-search
ln -s ~/skills/browser-tools .agents/skills/browser-tools
# ...
```

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
