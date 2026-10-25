#!/usr/bin/env bash
# Compatibility entry point; session resets require an approved foreground workflow.
set -euo pipefail
printf '%s\n' 'FOCUS_BLOCKED: automatic session bootstrap is unsupported.' 'Use API/CLI, or obtain an owner-issued foreground lease, start the session timer once, and run browser-start.js --host --resume. No proxy, browser, navigation or timer was changed.' >&2
exit 1
