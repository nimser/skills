#!/usr/bin/env bash
# Launcher the agent can run without resolving anything: symlinked skill
# directories make relative paths from SKILL.md point at the wrong tree.
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec bun "$here/../_scripts/commit/commit-driver.ts" --no-push "$@"
