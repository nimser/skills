#!/usr/bin/env bash
# Compatibility entry point; session resets require an approved foreground workflow.
set -euo pipefail
printf '%s\n' 'FOCUS_BLOCKED: automatic session bootstrap is unsupported.' 'Use API/CLI, or request a browser window with browser-start.js --foreground and confirm on the host desktop. No browser or network state was changed.' >&2
exit 1
