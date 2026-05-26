#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install dependencies (idempotent — safe to re-run)
cd "$SCRIPT_DIR"
npm install --quiet
echo "[browser-tools] Initialized."
