#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install dependencies
cd "$SCRIPT_DIR"
npm install --quiet
echo "[browser-tools] Initialized."
