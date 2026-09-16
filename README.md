# skills

A growing collection of skills for coding agents — compatible with [opencode](https://opencode.ai) and Claude Code.

These skills are opinionated workflow helpers. They're small, composable, and designed to be hacked on. Take what works, toss what doesn't, make them yours.

## Skills

```
Git & Commit Workflows
├── auto-commit-and-push            # commit driver, pushes via deploy key
├── auto-commit-dont-push           # commit driver, local commits only
├── commit-style-fun                 # playful Conventional Commits style
└── commit-style-classic             # no-frills Conventional Commits

Web & Browser
├── brave-search                    # web search via Brave API
├── browser-tools                   # Chrome DevTools Protocol automation
└── youtube-transcript              # YouTube transcript fetcher


Data
└── teable                          # Teable bases: typed fields, kanban views, records

Utilities
└── vscode                          # VS Code diffs & file comparison
```

## Layout

Directories starting with `_` are shared code, not skills: agents never load
them, and startup automation never scans them.

```
some-skill/
├── SKILL.md          # instructions loaded by the agent
├── init.sh           # one-shot setup script (idempotent), run at agent startup
└── ...               # helper scripts, configs, etc.

_scripts/             # shared executables several skills call
└── commit/           # the commit driver, its pre-flight and push-auth setup
```

`init.sh` scripts can be automatically executed at agent startup time via a
wrapper script or via agent plugins (e.g. an opencode plugin), so the agent
arrives in a ready-to-work state without manual intervention. Setup that only
some runs need — anything that talks to a remote, mints credentials or depends
on the task at hand — belongs in `_scripts/`, called on demand by the skill that
needs it, not in `init.sh`.

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

## Contributing

This repository is a mirror of a private one. It publishes the paths its allowlist names, so it may be a
subset of the project, and its history is regenerated from the source: tags are absent and commits can be
replaced. Pull requests cannot land here.
