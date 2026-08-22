#!/usr/bin/env bash
# code-style/init.sh — bootstrap OXC + strict tsconfig for a TypeScript project
# Interactive for existing projects (prompts before merge), non-interactive for fresh ones.
# Requires: Bash 4.4+, jq, git (optional but recommended)
# Usage: bash init.sh [target-dir] [-y|--yes]
#
# Local overrides:
#   Create a .code-style.local file in your project root to persistently
#   customize behavior. This file is NEVER overwritten by init.sh and is
#   automatically added to .git/info/exclude (local-only, not tracked).
#
#   Supported directives:
#     ignore_file = tsconfig.json             # Skip merging a config file entirely
#     ignore_script = typecheck               # Skip setting a specific script
#     ignore_dep = typescript                 # Skip installing a specific dependency
#     override = .file.json:{"k": "v"}         # Apply jq expression after merge
#     override_script = check|oxlint .         # Override a script (use | as delimiter)
set -euo pipefail

# ── argument parsing ────────────────────────────────────────
TARGET_DIR="."
AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=true
      shift
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

cd "$TARGET_DIR"

# ── color support (respects NO_COLOR and non-TTY) ────────
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[1;31m'
  C_GREEN=$'\033[32m'
else
  C_RESET="" C_YELLOW="" C_RED="" C_GREEN=""
fi

# ── helpers ──────────────────────────────────────────────
info() { echo "  code-style: $*"; }
warn() { echo "  ${C_YELLOW}⚠ $*${C_RESET}"; }
err()  { echo "  ${C_RED}✗ $*${C_RESET}"; exit 1; }

# ── auto-detect -y based on git remote ────────────────────
if [[ "$AUTO_YES" == false && -d .git ]] && command -v git &>/dev/null; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ "$REMOTE_URL" =~ github\.com/nimser/ || "$REMOTE_URL" =~ gitlab\.com/nimser/ ]]; then
    AUTO_YES=true
    info "auto-enabled -y mode (nimser/* remote detected)"
  fi
elif [[ "$AUTO_YES" == false && ! -d .git ]]; then
  AUTO_YES=true
  info "auto-enabled -y mode (no git repo)"
fi

# ── empty-array-safe iteration ──────────────────────────────
# Bash 4.3 and earlier crash on "${arr[@]}" with nounset when arr is empty.
# Bash 4.4 fixed this. We require 4.4+ but keep this guard as belt-and-suspenders.
iter() {
  local -n arr_ref=$1
  if [[ ${#arr_ref[@]} -gt 0 ]]; then
    printf '%s\n' "${arr_ref[@]}"
  fi
}

command -v jq &>/dev/null || err "jq is required"

# Recap state
PM_DETECTED=""
GIT_STATE=""
declare -a CONFIGS_CREATED=() CONFIGS_MERGED=() CONFIGS_SKIPPED=() CONFIGS_RENAMED=()
declare -a SCRIPTS_ADDED=()   SCRIPTS_PRESERVED=()
declare -a DEPS_INSTALLED=()  DEPS_PRESENT=()
declare -a GITIGNORE_ADDED=() GITIGNORE_PRESENT=()
declare -a TOOLS_REMOVED=()   TOOLS_WARNED=()
declare -a COMMIT_FILES=()
HOOK_STATE=""
PACKAGE_CREATED=false
PACKAGE_CHANGED=false

# ── early checks for existing project ────────────────────
SKIP_OXC=false
OXC_MODE=""

# Check if this is an existing project
if [[ -f package.json || -f .oxlintrc.json || -f .oxfmtrc.json || \
      -f .prettierrc || -f .prettierrc.json || -f .prettierrc.yml || \
      -f .prettierrc.yaml || -f .prettierrc.js || -f .prettierrc.cjs || \
      -f prettier.config.js || -f prettier.config.cjs ]]; then
  echo ""
  echo "  Existing project detected."
  if [[ "$AUTO_YES" == false ]]; then
    read -rp "  Set up code-style tooling? [Y/n] " -n 1 -r || true
    echo ""
    if [[ $REPLY == [Nn] ]]; then
      info "skipping setup (user declined)"
      exit 0
    fi
  else
    echo "  Set up code-style tooling? [Y/n] Y (auto)"
  fi
fi

# Check for prettier (config files, package.json dep, or inline config)
PRETTIER_CONFIGS=(.prettierrc .prettierrc.json .prettierrc.yml .prettierrc.yaml .prettierrc.js .prettierrc.cjs prettier.config.js prettier.config.cjs)
PRETTIER_FOUND=false
PRETTIER_CONFIG_FILE=""
for config in "${PRETTIER_CONFIGS[@]}"; do
  if [[ -f "$config" ]]; then
    PRETTIER_FOUND=true
    PRETTIER_CONFIG_FILE="$config"
    break
  fi
done

# Also detect prettier in package.json (devDependencies, inline "prettier" config key, or scripts)
PRETTIER_IN_DEPS=false
PRETTIER_INLINE_CONFIG=false
PRETTIER_IN_SCRIPTS=false
if [[ -f package.json ]]; then
  if jq -e '.dependencies.prettier // .devDependencies.prettier' package.json &>/dev/null; then
    PRETTIER_IN_DEPS=true
  fi
  if jq -e '.prettier' package.json &>/dev/null; then
    PRETTIER_INLINE_CONFIG=true
  fi
  if jq -e '[.scripts // {} | to_entries[] | select(.value | test("prettier"))] | length > 0' package.json &>/dev/null; then
    PRETTIER_IN_SCRIPTS=true
  fi
fi

if [[ $PRETTIER_FOUND == true || $PRETTIER_IN_DEPS == true || $PRETTIER_INLINE_CONFIG == true || $PRETTIER_IN_SCRIPTS == true ]]; then
  MIGRATE_PREPL="Y"
  if [[ "$AUTO_YES" == false ]]; then
    echo ""
    read -rp "  Migrate prettier to oxfmt? [Y/n] " -n 1 -r || true
    MIGRATE_PREPL="$REPLY"
    echo ""
  fi
  if [[ "$MIGRATE_PREPL" != [Nn] ]]; then
    # Remove prettier from package.json dependencies
    if [[ $PRETTIER_IN_DEPS == true ]]; then
      jq 'del(.dependencies.prettier) | del(.devDependencies.prettier)' package.json > package.json.tmp && mv package.json.tmp package.json
      TOOLS_REMOVED+=("prettier")
    fi
    # Remove inline prettier config from package.json
    if [[ $PRETTIER_INLINE_CONFIG == true ]]; then
      jq 'del(.prettier)' package.json > package.json.tmp && mv package.json.tmp package.json
      TOOLS_REMOVED+=("prettier-config-in-package.json")
    fi
    # Remove prettier config files
    for config in "${PRETTIER_CONFIGS[@]}"; do
      if [[ -f "$config" ]]; then
        rm "$config"
        TOOLS_REMOVED+=("$config")
      fi
    done
  else
    SKIP_OXC=true
  fi
fi

# Check for existing oxc configs (only if not already skipping)
if [[ $SKIP_OXC == false && (-f .oxlintrc.json || -f .oxfmtrc.json) ]]; then
  OXC_PREPL="m"
  if [[ "$AUTO_YES" == false ]]; then
    echo ""
    read -rp "  [M]erge with skill rules / [R]eplace / [K]eep existing: " -n 1 -r || true
    OXC_PREPL="$REPLY"
    echo ""
  fi
  case $OXC_PREPL in
    [Rr])
      rm -f .oxlintrc.json .oxfmtrc.json
      OXC_MODE="replace"
      ;;
    [Kk])
      SKIP_OXC=true
      ;;
    *)
      OXC_MODE="merge"
      ;;
  esac
fi

# Check for eslint (config files, package.json dep, inline config, or scripts)
ESLINT_CONFIGS=(.eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts eslint.config.mts)
ESLINT_FOUND=false
ESLINT_CONFIG_FILE=""
for config in "${ESLINT_CONFIGS[@]}"; do
  if [[ -f "$config" ]]; then
    ESLINT_FOUND=true
    ESLINT_CONFIG_FILE="$config"
    break
  fi
done

ESLINT_IN_DEPS=false
ESLINT_INLINE_CONFIG=false
ESLINT_IN_SCRIPTS=false
if [[ -f package.json ]]; then
  if jq -e '.dependencies.eslint // .devDependencies.eslint' package.json &>/dev/null; then
    ESLINT_IN_DEPS=true
  fi
  if jq -e '.eslintConfig' package.json &>/dev/null; then
    ESLINT_INLINE_CONFIG=true
  fi
  if jq -e '[.scripts // {} | to_entries[] | select(.value | test("eslint"))] | length > 0' package.json &>/dev/null; then
    ESLINT_IN_SCRIPTS=true
  fi
fi

if [[ $ESLINT_FOUND == true || $ESLINT_IN_DEPS == true || $ESLINT_INLINE_CONFIG == true || $ESLINT_IN_SCRIPTS == true ]]; then
  MIGRATE_ESLINT_REPL="Y"
  if [[ "$AUTO_YES" == false ]]; then
    echo ""
    read -rp "  Migrate eslint to oxlint? [Y/n] " -n 1 -r || true
    MIGRATE_ESLINT_REPL="$REPLY"
    echo ""
  fi
  if [[ "$MIGRATE_ESLINT_REPL" != [Nn] ]]; then
    # Remove eslint and related packages from package.json
    if [[ $ESLINT_IN_DEPS == true ]]; then
      jq '
        if .devDependencies then
          .devDependencies |= with_entries(select(.key | test("^eslint|^@typescript-eslint/(parser|eslint-plugin)$") | not))
        else . end |
        if .dependencies then
          .dependencies |= with_entries(select(.key | test("^eslint|^@typescript-eslint/(parser|eslint-plugin)$") | not))
        else . end
      ' package.json > package.json.tmp && mv package.json.tmp package.json
      TOOLS_REMOVED+=("eslint+plugins")
    fi
    # Remove inline eslint config from package.json
    if [[ $ESLINT_INLINE_CONFIG == true ]]; then
      jq 'del(.eslintConfig)' package.json > package.json.tmp && mv package.json.tmp package.json
      TOOLS_REMOVED+=("eslintConfig-in-package.json")
    fi
    # Remove eslint config files
    for config in "${ESLINT_CONFIGS[@]}"; do
      if [[ -f "$config" ]]; then
        rm "$config"
        TOOLS_REMOVED+=("$config")
      fi
    done
    # Remove .eslintignore if present
    if [[ -f .eslintignore ]]; then
      rm .eslintignore
      TOOLS_REMOVED+=(".eslintignore")
    fi
  else
    TOOLS_WARNED+=("eslint")
  fi
fi

# ── detect package manager ───────────────────────────────
if command -v vp &>/dev/null; then
  ADD="vp add -D"; RUN="vp run"
  PM_DETECTED="vp (vite-plus)"
elif command -v pnpm &>/dev/null; then
  ADD="pnpm add -D"; RUN="pnpm run"
  PM_DETECTED="pnpm"
else
  ADD="npm install --save-dev"; RUN="npm run"
  PM_DETECTED="npm"
fi

# ── .gitignore (before git init) ──────────────────────────
GITIGNORE_ENTRIES=("node_modules" "dist" "*.tsbuildinfo" ".env" ".pnpm-store")

if [[ ! -f .gitignore ]]; then
  for entry in "${GITIGNORE_ENTRIES[@]}"; do
    printf '%s\n' "$entry" >> .gitignore
    GITIGNORE_ADDED+=("$entry")
  done
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

# ── .git/info/exclude (local-only gitignore) ──────────────
# .code-style.local is user-specific, so it goes in .git/info/exclude
# instead of .gitignore (which is tracked and shared).
if [[ -d .git ]]; then
  EXCLUDE_FILE=".git/info/exclude"
  EXCLUDE_ENTRY=".code-style.local"
  if ! grep -qxF "$EXCLUDE_ENTRY" "$EXCLUDE_FILE" 2>/dev/null; then
    printf '%s\n' "$EXCLUDE_ENTRY" >> "$EXCLUDE_FILE"
  fi
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
           .oxlintrc.json .oxfmtrc.json; do
    [[ -f "$f" ]] && git add "$f" 2>/dev/null || true
  done
  GIT_STATE="initialized (staged existing files)"
fi

# ── rename .jsonc → .json before processing ───────────────
# If a project has e.g. .oxlintrc.jsonc but we want .json, rename it.
JSONC_VARIANTS=(.oxlintrc .oxfmtrc)
for base in "${JSONC_VARIANTS[@]}"; do
  if [[ -f "${base}.jsonc" && ! -f "${base}.json" ]]; then
    mv "${base}.jsonc" "${base}.json"
    CONFIGS_RENAMED+=("${base}.jsonc → ${base}.json")
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
  PACKAGE_CREATED=true
fi

# ── interactive merge prompt ──────────────────────────────
# Returns 0 = proceed, 1 = skip. Returns 0 if file doesn't exist.
prompt_merge() {
  local file="$1"
  if [[ ! -f "$file" ]]; then return 0; fi
  MERGE_PREPL="Y"
  if [[ "$AUTO_YES" == false ]]; then
    echo ""
    read -rp "  Merge into $file? [Y/n] " -n 1 -r || true
    MERGE_PREPL="$REPLY"
    echo ""
  fi
  if [[ "$MERGE_PREPL" == [Nn] ]]; then
    return 1
  fi
  return 0
}

# ── local overrides ───────────────────────────────────────
# Users can create .code-style.local to persistently skip files or override settings.
# This file is NEVER overwritten by init.sh. Add it to .git/info/exclude.
#
# Supported directives:
#   ignore_file = tsconfig.json        # Skip merging a config file entirely
#   ignore_script = typecheck          # Skip setting a specific script
#   ignore_dep = typescript            # Skip installing a specific dependency
#   override = .file.json:{"k": "v"}  # Apply jq expression after merge
#   override_script = check|oxlint .   # Override a script's command
LOCAL_IGNORE_FILES=()
LOCAL_IGNORE_SCRIPTS=()
LOCAL_IGNORE_DEPS=()
LOCAL_OVERRIDES=()
LOCAL_OVERRIDE_SCRIPTS=()
if [[ -f .code-style.local ]]; then
  while IFS= read -r line; do
    # Skip comments and blank lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Parse: ignore_file = tsconfig.json
    if [[ "$line" =~ ^ignore_file[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      file_to_ignore="${BASH_REMATCH[1]}"
      file_to_ignore="${file_to_ignore#"${file_to_ignore%%[![:space:]]*}"}"
      file_to_ignore="${file_to_ignore%"${file_to_ignore##*[![:space:]]}"}"
      LOCAL_IGNORE_FILES+=("$file_to_ignore")
    # Parse: ignore_script = format
    elif [[ "$line" =~ ^ignore_script[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      script_to_ignore="${BASH_REMATCH[1]}"
      script_to_ignore="${script_to_ignore#"${script_to_ignore%%[![:space:]]*}"}"
      script_to_ignore="${script_to_ignore%"${script_to_ignore##*[![:space:]]}"}"
      LOCAL_IGNORE_SCRIPTS+=("$script_to_ignore")
    # Parse: ignore_dep = typescript
    elif [[ "$line" =~ ^ignore_dep[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      dep_to_ignore="${BASH_REMATCH[1]}"
      dep_to_ignore="${dep_to_ignore#"${dep_to_ignore%%[![:space:]]*}"}"
      dep_to_ignore="${dep_to_ignore%"${dep_to_ignore##*[![:space:]]}"}"
      LOCAL_IGNORE_DEPS+=("$dep_to_ignore")
    # Parse: override = .file.json:{"key": "value"}
    elif [[ "$line" =~ ^override[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      override_spec="${BASH_REMATCH[1]}"
      override_spec="${override_spec#"${override_spec%%[![:space:]]*}"}"
      override_spec="${override_spec%"${override_spec##*[![:space:]]}"}"
      LOCAL_OVERRIDES+=("$override_spec")
    # Parse: override_script = format|oxfmt .
    elif [[ "$line" =~ ^override_script[[:space:]]*=[[:space:]]*(.+)$ ]]; then
      script_override="${BASH_REMATCH[1]}"
      script_override="${script_override#"${script_override%%[![:space:]]*}"}"
      script_override="${script_override%"${script_override##*[![:space:]]}"}"
      LOCAL_OVERRIDE_SCRIPTS+=("$script_override")
    fi
  done < .code-style.local
fi

# Helper functions
should_ignore_file() {
  local file="$1"
  for ignored in "${LOCAL_IGNORE_FILES[@]}"; do
    if [[ "$file" == "$ignored" ]]; then
      return 0
    fi
  done
  return 1
}

should_ignore_script() {
  local script="$1"
  for ignored in "${LOCAL_IGNORE_SCRIPTS[@]}"; do
    if [[ "$script" == "$ignored" ]]; then
      return 0
    fi
  done
  return 1
}

should_ignore_dep() {
  local dep="$1"
  for ignored in "${LOCAL_IGNORE_DEPS[@]}"; do
    if [[ "$dep" == "$ignored" ]]; then
      return 0
    fi
  done
  return 1
}

get_script_override() {
  local script="$1"
  for override in "${LOCAL_OVERRIDE_SCRIPTS[@]}"; do
    local override_name=$(echo "$override" | cut -d'|' -f1)
    local override_cmd=$(echo "$override" | cut -d'|' -f2-)
    if [[ "$override_name" == "$script" ]]; then
      echo "$override_cmd"
      return 0
    fi
  done
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
if [[ $SKIP_OXC == true ]]; then
  CONFIG_ORDER=(tsconfig.json tsconfig.build.json)
else
  CONFIG_ORDER=(.oxlintrc.json .oxfmtrc.json tsconfig.json tsconfig.build.json)
fi

# ── process config files ──────────────────────────────────
merge_config() {
  local file="$1" new_json="$2"

  # Check if this file is in the local ignore list
  if should_ignore_file "$file"; then
    info "skipping $file (listed in .code-style.local ignore_file)"
    CONFIGS_SKIPPED+=("$file")
    return 0  # Not an error, just skipped
  fi

  # If OXC_MODE is "replace", delete existing oxc configs first
  if [[ "$OXC_MODE" == "replace" && ("$file" == ".oxlintrc.json" || "$file" == ".oxfmtrc.json") ]]; then
    rm -f "$file"
  fi

  if [[ ! -f "$file" ]]; then
    printf '%s\n' "$new_json" > "$file"
    CONFIGS_CREATED+=("$file")
    # Apply local overrides even for newly created files
    apply_overrides "$file"
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

  # Apply local overrides
  apply_overrides "$file"

  CONFIGS_MERGED+=("$file")
}

# Helper function to apply local overrides
apply_overrides() {
  local file="$1"
  for override in "${LOCAL_OVERRIDES[@]}"; do
    override_file=$(echo "$override" | cut -d':' -f1)
    override_key=$(echo "$override" | cut -d':' -f2-)
    if [[ "$override_file" == "$file" && -n "$override_key" ]]; then
      info "applying local override to $file: $override_key"
      # Parse the override as a jq expression and apply it
      echo "$override_key" | jq -c '.' > /dev/null 2>&1 || {
        warn "invalid override syntax in .code-style.local: $override_key"
        continue
      }
      jq --argjson override "$override_key" '. * $override' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    fi
  done
}

for file in "${CONFIG_ORDER[@]}"; do
  merge_config "$file" "${EXPECTED[$file]}" || true
done

# ── scripts (track per-script: added vs preserved) ────────
# Deterministic order (skip oxc scripts if SKIP_OXC is true)
if [[ $SKIP_OXC == true ]]; then
  SCRIPT_ORDER=(format format:check typecheck check)
else
  SCRIPT_ORDER=(lint lint:fix format format:check typecheck check)
fi

# Filter out ignored scripts
FILTERED_SCRIPT_ORDER=()
for script in "${SCRIPT_ORDER[@]}"; do
  if ! should_ignore_script "$script"; then
    FILTERED_SCRIPT_ORDER+=("$script")
  else
    info "skipping script $script (listed in .code-style.local ignore_script)"
  fi
done
SCRIPT_ORDER=("${FILTERED_SCRIPT_ORDER[@]}")

declare -A SCRIPT_VALUES
LINT_PATHS="find -P . \\( -type d \\( -name .git -o -name node_modules -o -name dist -o -name .pnpm-store \\) -prune \\) -o -type f \\( -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \\)"
LINT_COMMAND="$LINT_PATHS -exec oxlint --type-aware {} +"
LINT_FIX_COMMAND="$LINT_PATHS -exec oxlint --type-aware --fix {} +"
SCRIPT_VALUES[lint]="$LINT_COMMAND"
SCRIPT_VALUES[lint:fix]="$LINT_FIX_COMMAND"
SCRIPT_VALUES[format]="oxfmt ."
SCRIPT_VALUES[format:check]="oxfmt --check ."
SCRIPT_VALUES[typecheck]="tsc --noEmit"
SCRIPT_VALUES[check]="$LINT_COMMAND && oxfmt --check . && tsc --noEmit"

# Apply script overrides from .code-style.local
for override in "${LOCAL_OVERRIDE_SCRIPTS[@]}"; do
  override_name=$(echo "$override" | cut -d'|' -f1)
  override_cmd=$(echo "$override" | cut -d'|' -f2-)
  if [[ -n "$override_name" && -n "$override_cmd" ]]; then
    SCRIPT_VALUES["$override_name"]="$override_cmd"
    info "overriding script $override_name: $override_cmd"
  fi
done

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

# Build the script map with jq args so shell commands can contain quotes and escapes.
PACKAGE_SNAPSHOT=$(mktemp)
cp package.json "$PACKAGE_SNAPSHOT"
SCRIPT_JSON='{}'
for script in "${SCRIPT_ORDER[@]}"; do
  SCRIPT_JSON=$(jq --arg name "$script" --arg value "${SCRIPT_VALUES[$script]}" \
    '.[$name] = $value' <<<"$SCRIPT_JSON")
done

jq --argjson scripts "$SCRIPT_JSON" \
  '.scripts = ((.scripts // {}) * $scripts)' \
  package.json > package.json.tmp && mv package.json.tmp package.json
if ! cmp -s package.json "$PACKAGE_SNAPSHOT"; then
  PACKAGE_CHANGED=true
fi
rm -f "$PACKAGE_SNAPSHOT"

# ── install devDependencies ──────────────────────────────
NEED=()
if [[ $SKIP_OXC == true ]]; then
  # Skip oxc dependencies and install only typescript.
  DEPS_TO_CHECK=(typescript)
else
  DEPS_TO_CHECK=(oxlint oxfmt typescript)
fi

# oxlint-tsgolint is required for --type-aware linting
if [[ $SKIP_OXC != true ]]; then
  # Check if any lint/check script uses --type-aware
  if echo "${SCRIPT_VALUES[lint]} ${SCRIPT_VALUES[lint:fix]} ${SCRIPT_VALUES[check]}" | grep -q -- "--type-aware"; then
    DEPS_TO_CHECK+=(oxlint-tsgolint)
  fi
fi

# Filter out ignored dependencies
FILTERED_DEPS=()
for dep in "${DEPS_TO_CHECK[@]}"; do
  if ! should_ignore_dep "$dep"; then
    FILTERED_DEPS+=("$dep")
  else
    info "skipping dependency $dep (listed in .code-style.local ignore_dep)"
  fi
done
DEPS_TO_CHECK=("${FILTERED_DEPS[@]}")

for dep in "${DEPS_TO_CHECK[@]}"; do
  if jq -e --arg d "$dep" '.devDependencies[$d] // .dependencies[$d]' package.json &>/dev/null; then
    DEPS_PRESENT+=("$dep")
  else
    NEED+=("$dep")
  fi
done

if [[ ${#NEED[@]} -gt 0 ]]; then
  $ADD "${NEED[@]}"
  DEPS_INSTALLED+=("${NEED[@]}")
  COMMIT_FILES+=("package.json")
  case "$PM_DETECTED" in
    "vp (vite-plus)"|pnpm)
      [[ -f pnpm-lock.yaml ]] && COMMIT_FILES+=("pnpm-lock.yaml")
      [[ -f pnpm-workspace.yaml ]] && COMMIT_FILES+=("pnpm-workspace.yaml")
      ;;
    npm)
      [[ -f package-lock.json ]] && COMMIT_FILES+=("package-lock.json")
      ;;
  esac
fi

# Format before the bootstrap commit so the new hook starts from a clean tree.
if [[ -d .git ]] && ! should_ignore_script format; then
  if [[ ${#CONFIGS_CREATED[@]} -gt 0 || ${#CONFIGS_MERGED[@]} -gt 0 || \
        ${#CONFIGS_RENAMED[@]} -gt 0 || ${#SCRIPTS_ADDED[@]} -gt 0 || \
        ${#DEPS_INSTALLED[@]} -gt 0 || ${#GITIGNORE_ADDED[@]} -gt 0 ]]; then
    $RUN format
  fi
fi

# ── commit block ──────────────────────────────────────────
# Commit only files created/modified by this script (not other working dir changes)
if [[ -d .git ]] && command -v git &>/dev/null; then
  # Collect all files that were created or modified
  for f in "${CONFIGS_CREATED[@]}"; do [[ -f "$f" ]] && COMMIT_FILES+=("$f"); done
  for f in "${CONFIGS_MERGED[@]}"; do [[ -f "$f" ]] && COMMIT_FILES+=("$f"); done
  for f in "${CONFIGS_RENAMED[@]}"; do
    # Extract the new filename from "old.jsonc → new.json"
    NEW_FILE="${f##*→ }"
    [[ -f "$NEW_FILE" ]] && COMMIT_FILES+=("$NEW_FILE")
  done
  [[ -f ".gitignore" ]] && [[ ${#GITIGNORE_ADDED[@]} -gt 0 ]] && COMMIT_FILES+=(".gitignore")
  [[ "$PACKAGE_CREATED" == true || "$PACKAGE_CHANGED" == true || ${#TOOLS_REMOVED[@]} -gt 0 ]] && COMMIT_FILES+=("package.json")
  if [[ "$PM_DETECTED" == "vp (vite-plus)" ]]; then
    for f in pnpm-lock.yaml pnpm-workspace.yaml; do
      if [[ -f "$f" ]] && ! git ls-files --error-unmatch "$f" &>/dev/null; then
        COMMIT_FILES+=("$f")
      fi
    done
  fi

  # Stage only tracked files
  if [[ ${#COMMIT_FILES[@]} -gt 0 ]]; then
    STAGED_FILES=()
    for f in "${COMMIT_FILES[@]}"; do
      if git ls-files --error-unmatch "$f" &>/dev/null || [[ -f "$f" ]]; then
        git add -f "$f" 2>/dev/null && STAGED_FILES+=("$f")
      fi
    done

    # Only commit if there are staged changes
    if [[ ${#STAGED_FILES[@]} -gt 0 ]] && ! git diff --cached --quiet; then
      COMMIT_MSG=$(cat <<'EOF'
🎨 style: bootstrap code-style tooling

Add strict TypeScript + OXC linting/formatting configuration

- Install oxlint, oxfmt, typescript
- Configure tsconfig with strict mode + noUncheckedIndexedAccess
- Add lint, format, typecheck, and check scripts
- Install pre-commit hook for future commits
- Format bootstrap files before the initial commit
- Set up .gitignore entries (node_modules, dist, *.tsbuildinfo, .pnpm-store)
- Enforce single quotes, no semicolons, 100 char line width

Tooling: oxlint (--type-aware) + oxfmt + tsc
EOF
)
      git commit -m "$COMMIT_MSG" --quiet
    fi
  fi
fi

# ── pre-commit hook ─────────────────────────────────────────
# Install after the bootstrap commit so an empty project can initialize cleanly.
if [[ -d .git ]]; then
  HOOK_DIR=".git/hooks"
  HOOK_FILE="${HOOK_DIR}/pre-commit"
  mkdir -p "$HOOK_DIR"

  if [[ -f "$HOOK_FILE" ]] && grep -q "code-style/init.sh" "$HOOK_FILE"; then
    # Our hook already installed — refresh silently
    cat > "$HOOK_FILE" <<HOOKEOF
#!/usr/bin/env bash
# pre-commit hook — installed by code-style/init.sh
# Bypass: git commit --no-verify
set -e
${RUN} format
${RUN} check
HOOKEOF
    chmod +x "$HOOK_FILE"
    HOOK_STATE="refreshed"
  elif [[ -f "$HOOK_FILE" ]]; then
    # Someone else's hook — never overwrite silently
    HOOK_STATE="skipped (existing hook preserved)"
    TOOLS_WARNED+=("pre-commit-hook")
  else
    INSTALL_HOOK=true
    if [[ "$AUTO_YES" == false ]]; then
      echo ""
      read -rp "  Set up pre-commit hook (format + check before every commit)? [Y/n] " -n 1 -r || true
      echo ""
      if [[ $REPLY == [Nn] ]]; then
        INSTALL_HOOK=false
      fi
    fi
    if [[ "$INSTALL_HOOK" == true ]]; then
      cat > "$HOOK_FILE" <<HOOKEOF
#!/usr/bin/env bash
# pre-commit hook — installed by code-style/init.sh
# Bypass: git commit --no-verify
set -e
${RUN} format
${RUN} check
HOOKEOF
      chmod +x "$HOOK_FILE"
      HOOK_STATE="installed"
    else
      HOOK_STATE="skipped (user declined)"
    fi
  fi
else
  HOOK_STATE="skipped (no .git)"
fi

# ── recap ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Warnings first (most important)
if [[ ${#TOOLS_REMOVED[@]} -gt 0 || ${#TOOLS_WARNED[@]} -gt 0 ]]; then
  for tool in "${TOOLS_REMOVED[@]}"; do echo "  ${C_RED}✗ removed:${C_RESET} $tool"; done
  for tool in "${TOOLS_WARNED[@]}"; do echo "  ${C_YELLOW}⚠ kept:${C_RESET} $tool"; done
  echo ""
fi

# Status line
STATUS="PM: ${PM_DETECTED} | Git: ${GIT_STATE}"
if [[ $SKIP_OXC == true ]]; then
  STATUS+=" | OXC: skipped"
elif [[ -n "$OXC_MODE" ]]; then
  STATUS+=" | OXC: ${OXC_MODE}"
fi
[[ -n "$HOOK_STATE" ]] && STATUS+=" | Hook: ${HOOK_STATE}"
echo "  $STATUS"

# Config files (compact)
if [[ ${#CONFIGS_CREATED[@]} -gt 0 || ${#CONFIGS_MERGED[@]} -gt 0 || ${#CONFIGS_SKIPPED[@]} -gt 0 ]]; then
  CONFIG_LINE=""
  for f in "${CONFIGS_CREATED[@]}"; do CONFIG_LINE+="${C_GREEN}+$f${C_RESET} "; done
  for f in "${CONFIGS_MERGED[@]}";  do CONFIG_LINE+="~$f "; done
  for f in "${CONFIGS_SKIPPED[@]}"; do CONFIG_LINE+="${C_YELLOW}-$f${C_RESET} "; done
  echo "  Config: ${CONFIG_LINE% }"
fi

# Scripts (compact)
if [[ ${#SCRIPTS_ADDED[@]} -gt 0 || ${#SCRIPTS_PRESERVED[@]} -gt 0 ]]; then
  SCRIPT_LINE=""
  for s in "${SCRIPTS_ADDED[@]}"; do SCRIPT_LINE+="${C_GREEN}+$s${C_RESET} "; done
  for s in "${SCRIPTS_PRESERVED[@]}"; do SCRIPT_LINE+="~$s "; done
  echo "  Scripts: ${SCRIPT_LINE% }"
fi

# Dependencies (compact)
if [[ ${#DEPS_INSTALLED[@]} -gt 0 || ${#DEPS_PRESENT[@]} -gt 0 ]]; then
  DEP_LINE=""
  for d in "${DEPS_INSTALLED[@]}"; do DEP_LINE+="${C_GREEN}+$d${C_RESET} "; done
  for d in "${DEPS_PRESENT[@]}";   do DEP_LINE+="~$d "; done
  echo "  Deps: ${DEP_LINE% }"
fi

# .gitignore (compact)
if [[ ${#GITIGNORE_ADDED[@]} -gt 0 ]]; then
  GIT_LINE=""
  for entry in "${GITIGNORE_ADDED[@]}"; do GIT_LINE+="${C_GREEN}+$entry${C_RESET} "; done
  echo "  .gitignore: ${GIT_LINE% }"
fi

# Renames (compact)
if [[ ${#CONFIGS_RENAMED[@]} -gt 0 ]]; then
  echo "  Renamed: ${CONFIGS_RENAMED[*]}"
fi

echo ""
TOTAL_ACTIONS=$(( ${#CONFIGS_CREATED[@]} + ${#CONFIGS_MERGED[@]} + \
                  ${#SCRIPTS_ADDED[@]}   + ${#DEPS_INSTALLED[@]} ))

if [[ $TOTAL_ACTIONS -eq 0 ]]; then
  echo "  ${C_GREEN}✓${C_RESET} Nothing to do — project already fully configured"
else
  echo "  ${C_GREEN}✓${C_RESET} Setup complete — try: $RUN check"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
