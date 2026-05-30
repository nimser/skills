#!/usr/bin/env bash
# code-style/init.sh — bootstrap OXC + dprint + strict tsconfig for a TypeScript project
# Interactive for existing projects (prompts before merge), non-interactive for fresh ones.
# Requires: Bash 4.4+, jq, git (optional but recommended)
# Usage: bash init.sh [target-dir]
set -euo pipefail
cd "${1:-.}"

# ── empty-array-safe iteration ──────────────────────────────
# Bash 4.3 and earlier crash on "${arr[@]}" with nounset when arr is empty.
# Bash 4.4 fixed this. We require 4.4+ but keep this guard as belt-and-suspenders.
iter() {
  local -n arr_ref=$1
  if [[ ${#arr_ref[@]} -gt 0 ]]; then
    printf '%s\n' "${arr_ref[@]}"
  fi
}

# ── helpers ──────────────────────────────────────────────
info() { echo "  code-style: $*"; }
warn() { echo "  (skipping $1 — already exists)"; }
err()  { echo "  ✗ $*"; exit 1; }

command -v jq &>/dev/null || err "jq is required"

# Recap state
PM_DETECTED=""
GIT_STATE=""
declare -a CONFIGS_CREATED=() CONFIGS_MERGED=() CONFIGS_SKIPPED=() CONFIGS_RENAMED=()
declare -a SCRIPTS_ADDED=()   SCRIPTS_PRESERVED=()
declare -a DEPS_INSTALLED=()  DEPS_PRESENT=()
declare -a GITIGNORE_ADDED=() GITIGNORE_PRESENT=()

# ── detect package manager ───────────────────────────────
if command -v vp &>/dev/null; then
  ADD="vp add -D"; RUN="vp run"
  PM_DETECTED="vp (vite-plus)"
  info "using vite-plus (vp)"
elif command -v pnpm &>/dev/null; then
  ADD="pnpm add -D"; RUN="pnpm run"
  PM_DETECTED="pnpm"
  info "using pnpm"
else
  ADD="npm install --save-dev"; RUN="npm run"
  PM_DETECTED="npm"
  info "using npm (fallback)"
fi

# ── .gitignore (before git init) ──────────────────────────
GITIGNORE_ENTRIES=("node_modules" "dist" "*.tsbuildinfo" ".env")

if [[ ! -f .gitignore ]]; then
  for entry in "${GITIGNORE_ENTRIES[@]}"; do
    printf '%s\n' "$entry" >> .gitignore
    GITIGNORE_ADDED+=("$entry")
  done
  info "created .gitignore"
else
  for entry in "${GITIGNORE_ENTRIES[@]}"; do
    if ! grep -qxF "$entry" .gitignore; then
      printf '%s\n' "$entry" >> .gitignore
      GITIGNORE_ADDED+=("$entry")
    else
      GITIGNORE_PRESENT+=("$entry")
    fi
  done
fi

# ── git backup (init + stage if no repo exists) ──────────
if [[ -d .git ]]; then
  GIT_STATE="already initialized"
elif ! command -v git &>/dev/null; then
  GIT_STATE="git not available (no backup)"
else
  git init -q
  # Stage existing files so the user can diff/revert after this script runs
  for f in package.json .gitignore tsconfig.json tsconfig.build.json \
           .oxlintrc.json .oxfmtrc.json .dprint.json; do
    [[ -f "$f" ]] && git add "$f" 2>/dev/null || true
  done
  GIT_STATE="initialized (staged existing files — git checkout -- <file> to revert)"
  info "git initialized — existing files staged for revert"
fi

# ── rename .jsonc → .json before processing ───────────────
# If a project has e.g. .oxlintrc.jsonc but we want .json, rename it.
JSONC_VARIANTS=(.oxlintrc .oxfmtrc .dprint)
for base in "${JSONC_VARIANTS[@]}"; do
  if [[ -f "${base}.jsonc" && ! -f "${base}.json" ]]; then
    mv "${base}.jsonc" "${base}.json"
    CONFIGS_RENAMED+=("${base}.jsonc → ${base}.json")
    info "renamed ${base}.jsonc → ${base}.json"
  elif [[ -f "${base}.jsonc" && -f "${base}.json" ]]; then
    warn "${base}.jsonc (kept alongside ${base}.json — you may want to delete .jsonc manually)"
  fi
done

# ── scaffold package.json if absent ───────────────────────
if [[ ! -f package.json ]]; then
  cat > package.json <<'PKG'
{
  "name": "",
  "private": true,
  "type": "module",
  "scripts": {}
}
PKG
  info "created minimal package.json"
fi

# ── interactive merge prompt ──────────────────────────────
# Returns 0 = proceed, 1 = skip. Returns 0 if file doesn't exist.
prompt_merge() {
  local file="$1"
  if [[ ! -f "$file" ]]; then return 0; fi
  echo ""
  echo "  Found existing $file"
  read -rp "  Merge missing/conflicting options into $file? [y/N] " -n 1 -r || true
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then return 0; fi
  warn "$file"
  return 1
}

# ── expected configs (all JSON) ───────────────────────────
declare -A EXPECTED

EXPECTED[.oxlintrc.json]='{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxlint/main/crates/oxc_linter/src/configuration_schema.json",
  "env": { "browser": true, "node": true },
  "plugins": ["typescript", "unicorn", "eslint"],
  "rules": {
    "no-console": "error",
    "typescript/no-explicit-any": "error"
  }
}'

EXPECTED[.oxfmtrc.json]='{
  "singleQuote": true,
  "semi": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "ignorePatterns": ["**/*.md"]
}'

EXPECTED[.dprint.json]='{
  "markdown": {
    "textWrap": "maintain",
    "lineWidth": 10000,
    "emphasisKind": "underscores",
    "strongKind": "asterisks"
  },
  "includes": ["**/*.md"],
  "plugins": ["https://plugins.dprint.dev/markdown-0.21.1.wasm"]
}'

EXPECTED[tsconfig.json]='{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}'

EXPECTED[tsconfig.build.json]='{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "exclude": ["dist", "node_modules", "**/*.test.ts", "**/*.spec.ts"]
}'

# Deterministic processing order (avoids bash assoc-array hash-order chaos)
CONFIG_ORDER=(.oxlintrc.json .oxfmtrc.json .dprint.json tsconfig.json tsconfig.build.json)

# ── process config files ──────────────────────────────────
merge_config() {
  local file="$1" new_json="$2"

  if [[ ! -f "$file" ]]; then
    printf '%s\n' "$new_json" > "$file"
    CONFIGS_CREATED+=("$file")
    info "created $file"
    return 0
  fi

  if ! prompt_merge "$file"; then
    CONFIGS_SKIPPED+=("$file")
    return 1
  fi

  case "$file" in
    .oxlintrc.json)
      jq --argjson new "$new_json" '
        .plugins = ((.plugins // []) + ($new.plugins // []) | unique) |
        .env     = ((.env     // {}) + ($new.env     // {}))         |
        .rules   = ((.rules   // {}) + ($new.rules   // {}))
      ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      ;;
    .oxfmtrc.json)
      jq --argjson new "$new_json" '
        . + $new |
        .ignorePatterns = ((.ignorePatterns // []) | unique)
      ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      ;;
    .dprint.json)
      jq --argjson new "$new_json" '
        .markdown = ((.markdown // {}) + ($new.markdown // {}))       |
        .includes = ((.includes // []) + ($new.includes // []) | unique) |
        .plugins  = ((.plugins  // []) + ($new.plugins  // []) | unique)
      ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      ;;
    tsconfig.json)
      jq --argjson new "$new_json" '
        .compilerOptions = ((.compilerOptions // {}) + ($new.compilerOptions // {}))           |
        .include         = ((.include // []) + ($new.include // []) | unique)                  |
        .exclude         = ((.exclude // []) + ($new.exclude // []) | unique)
      ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      ;;
    tsconfig.build.json)
      jq --argjson new "$new_json" '
        .extends         = (.extends // $new.extends)                                          |
        .compilerOptions = ((.compilerOptions // {}) + ($new.compilerOptions // {}))           |
        .exclude         = ((.exclude // []) + ($new.exclude // []) | unique)
      ' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
      ;;
  esac

  CONFIGS_MERGED+=("$file")
  info "merged missing options into $file"
}

for file in "${CONFIG_ORDER[@]}"; do
  merge_config "$file" "${EXPECTED[$file]}" || true
done

# ── scripts (track per-script: added vs preserved) ────────
# Deterministic order
SCRIPT_ORDER=(lint lint:fix format format:check typecheck check)

declare -A SCRIPT_VALUES
SCRIPT_VALUES[lint]="oxlint ."
SCRIPT_VALUES[lint:fix]="oxlint --fix ."
SCRIPT_VALUES[format]="oxfmt . && dprint fmt"
SCRIPT_VALUES[format:check]="oxfmt --check . && dprint check"
SCRIPT_VALUES[typecheck]="tsc --noEmit"
SCRIPT_VALUES[check]="oxlint . && oxfmt --check . && dprint check && tsc --noEmit"

# Track which scripts will be added vs preserved BEFORE the merge
declare -A PRESERVED_SCRIPT_VALUES

for script in "${SCRIPT_ORDER[@]}"; do
  existing=$(jq -r --arg s "$script" '.scripts[$s] // empty' package.json 2>/dev/null)
  if [[ -z "$existing" ]]; then
    SCRIPTS_ADDED+=("$script")
  else
    SCRIPTS_PRESERVED+=("$script")
    PRESERVED_SCRIPT_VALUES["$script"]="$existing"
  fi
done

# jq: only add keys that don't already exist (//=)
jq '
  .scripts = .scripts // {} |
  .scripts.lint              //= "oxlint ." |
  .scripts["lint:fix"]       //= "oxlint --fix ." |
  .scripts.format            //= "oxfmt . && dprint fmt" |
  .scripts["format:check"]   //= "oxfmt --check . && dprint check" |
  .scripts.typecheck         //= "tsc --noEmit" |
  .scripts.check             //= "oxlint . && oxfmt --check . && dprint check && tsc --noEmit"
' package.json > package.json.tmp && mv package.json.tmp package.json

# ── install devDependencies ──────────────────────────────
NEED=()
for dep in oxlint oxfmt dprint typescript; do
  if jq -e --arg d "$dep" '.devDependencies[$d] // .dependencies[$d]' package.json &>/dev/null; then
    DEPS_PRESENT+=("$dep")
  else
    NEED+=("$dep")
  fi
done

if [[ ${#NEED[@]} -gt 0 ]]; then
  info "installing: ${NEED[*]}"
  $ADD "${NEED[@]}"
  DEPS_INSTALLED=("${NEED[@]}")
fi

# ── recap ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Code Style Init — Recap"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
printf '  %-18s %s\n' "Package manager:" "$PM_DETECTED"
printf '  %-18s %s\n' "Git:"             "$GIT_STATE"
echo ""

# .gitignore
if [[ ${#GITIGNORE_ADDED[@]} -gt 0 || ${#GITIGNORE_PRESENT[@]} -gt 0 ]]; then
  echo "  .gitignore:"
  for entry in "${GITIGNORE_ADDED[@]}";   do printf '    + %-20s (added)\n'    "$entry"; done
  for entry in "${GITIGNORE_PRESENT[@]}"; do printf '    ~ %-20s (present)\n'  "$entry"; done
  echo ""
fi

# Renames
if [[ ${#CONFIGS_RENAMED[@]} -gt 0 ]]; then
  echo "  Renamed (.jsonc → .json):"
  for r in "${CONFIGS_RENAMED[@]}"; do printf '    → %s\n' "$r"; done
  echo ""
fi

# Config files
echo "  Config files:"
for f in "${CONFIGS_CREATED[@]}"; do printf '    + %-22s created\n'  "$f"; done
for f in "${CONFIGS_MERGED[@]}";  do printf '    ~ %-22s merged\n'   "$f"; done
for f in "${CONFIGS_SKIPPED[@]}"; do printf '    - %-22s skipped\n'  "$f"; done
echo ""

# Scripts
echo "  Scripts:"
for s in "${SCRIPTS_ADDED[@]}"; do
  printf '    + %-22s added (%s)\n' "$s" "${SCRIPT_VALUES[$s]}"
done
for s in "${SCRIPTS_PRESERVED[@]}"; do
  printf '    ~ %-22s preserved (%s)\n' "$s" "${PRESERVED_SCRIPT_VALUES[$s]}"
done
echo ""

# Dependencies
echo "  Dependencies:"
for d in "${DEPS_INSTALLED[@]}"; do printf '    + %-22s installed\n'  "$d"; done
for d in "${DEPS_PRESENT[@]}";   do printf '    ~ %-22s present\n'    "$d"; done
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TOTAL_ACTIONS=$(( ${#CONFIGS_CREATED[@]} + ${#CONFIGS_MERGED[@]} + \
                  ${#SCRIPTS_ADDED[@]}   + ${#DEPS_INSTALLED[@]} ))

if [[ $TOTAL_ACTIONS -eq 0 ]]; then
  echo "  Nothing to do — project already fully configured"
else
  echo "  ✓ Setup complete"
  echo "  Try: $RUN check"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
