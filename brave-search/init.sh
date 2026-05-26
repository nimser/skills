#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Setup (human — only needed once):
#   1. Create account at https://api-dashboard.search.brave.com/register
#   2. Create a "Free AI" subscription (credit card required, won't be charged)
#   3. Create an API key for the subscription
#   4. Add to shell profile (~/.profile or ~/.zprofile):
#        export BRAVE_API_KEY="your-api-key-here"

# 1. Check API key
if [ -z "$BRAVE_API_KEY" ]; then
  echo "[brave-search] BRAVE_API_KEY not set."
  echo "  1. Sign up: https://api-dashboard.search.brave.com/register"
  echo "  2. Create a Free AI subscription + API key"
  echo "  3. Add to shell profile:"
  echo "       export BRAVE_API_KEY=\"your-key-here\""
  exit 1
fi

# 2. Install dependencies
cd "$SCRIPT_DIR"
npm install --quiet
echo "[brave-search] Initialized."
