#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Check API key
if [ -z "$BRAVE_API_KEY" ]; then
  echo "[brave-search] BRAVE_API_KEY not set. Add to shell profile:"
  echo "  export BRAVE_API_KEY=\"your-api-key-here\""
  exit 1
fi

# 2. Install dependencies
cd "$SCRIPT_DIR"
npm install --quiet
echo "[brave-search] Initialized."
