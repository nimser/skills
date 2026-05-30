#!/usr/bin/env bash
# code-style/init.sh — bootstrap OXC + dprint + strict tsconfig for a TypeScript project
# Interactive for existing projects (prompts before merge), non-interactive for fresh ones.
# Requires: Bash 4.4+, jq, git (optional but recommended)
# Usage: bash init.sh [target-dir] [-y|--yes]
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
declare -a TOOLS_REMOVED=()   TOOLS_WARNED=()
declare -a COMMIT_FILES=()

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

# Check for prettier config
PRETTIER_CONFIGS=(.prettierrc .prettierrc.json .prettierrc.yml .prettierrc.yaml .prettierrc.js .prettierrc.cjs prettier.config.js prettier.config.cjs)
PRETTIER_FOUND=false
for config in "${PRETTIER_CONFIGS[@]}"; do
  if [[ -f "$config" ]]; then
    PRETTIER_FOUND=true
    break
  fi
done

if [[ $PRETTIER_FOUND == true ]]; then
  echo ""
  echo "  Found prettier configuration."
  MIGRATE_PREPL="Y"
  if [[ "$AUTO_YES" == false ]]; then
    read -rp "  Migrate to oxc (oxfmt)? [Y/n] " -n 1 -r || true
    MIGRATE_PREPL="$REPLY"
  fi
  echo ""
  if [[ "$MIGRATE_PREPL" != [Nn] ]]; then
    info "migrating from prettier to oxfmt"
    # Remove prettier from package.json if present
    if jq -e '.dependencies.prettier // .devDependencies.prettier' package.json &>/dev/null; then
      jq 'del(.dependencies.prettier) | del(.devDependencies.prettier)' package.json > package.json.tmp && mv package.json.tmp package.json
      TOOLS_REMOVED+=("prettier")
    fi
    # Remove prettier config files
    for config in "${PRETTIER_CONFIGS[@]}"; do
      if [[ -f "$config" ]]; then
        rm "$config"
        TOOLS_REMOVED+=("$config")
        info "removed $config"
      fi
    done
  else
    info "keeping prettier (skipping oxc setup)"
    SKIP_OXC=true
  fi
fi

# Check for existing oxc configs (only if not already skipping)
if [[ $SKIP_OXC == false && (-f .oxlintrc.json || -f .oxfmtrc.json) ]]; then
  echo ""
  echo "  Found existing oxc configuration."
  OXC_PREPL="m"
  if [[ "$AUTO_YES" == false ]]; then
    read -rp "  [M]erge with skill rules / [R]eplace / [K]eep existing: " -n 1 -r || true
    OXC_PREPL="$REPLY"
  fi
  echo ""
  case $OXC_PREPL in
    [Rr])
      info "replacing existing oxc configs with skill rules"
      rm -f .oxlintrc.json .oxfmtrc.json
      OXC_MODE="replace"
      ;;
    [Kk])
      info "keeping existing oxc configs (skipping oxc setup)"
      SKIP_OXC=true
      ;;
    *)
      info "merging skill rules with existing oxc configs"
      OXC_MODE="merge"
      ;;
  esac
fi

# ESLint: warn but don't auto-remove (user should manually migrate)
if jq -e '.dependencies.eslint // .devDependencies.eslint' package.json &>/dev/null; then
  warn "eslint detected — consider migrating to oxlint for better performance"
  warn "eslint and oxlint have overlapping rules and may conflict"
  TOOLS_WARNED+=("eslint")
fi

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
  MERGE_PREPL="Y"
  if [[ "$AUTO_YES" == false ]]; then
    read -rp "  Merge missing/conflicting options into $file? [Y/n] " -n 1 -r || true
    MERGE_PREPL="$REPLY"
  fi
  echo ""
  if [[ "$MERGE_PREPL" == [Nn] ]]; then
    warn "$file"
    return 1
  fi
  return 0
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
if [[ $SKIP_OXC == true ]]; then
  CONFIG_ORDER=(.dprint.json tsconfig.json tsconfig.build.json)
else
  CONFIG_ORDER=(.oxlintrc.json .oxfmtrc.json .dprint.json tsconfig.json tsconfig.build.json)
fi

# ── process config files ──────────────────────────────────
merge_config() {
  local file="$1" new_json="$2"

  # If OXC_MODE is "replace", delete existing oxc configs first
  if [[ "$OXC_MODE" == "replace" && ("$file" == ".oxlintrc.json" || "$file" == ".oxfmtrc.json") ]]; then
    rm -f "$file"
  fi

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
# Deterministic order (skip oxc scripts if SKIP_OXC is true)
if [[ $SKIP_OXC == true ]]; then
  SCRIPT_ORDER=(format format:check typecheck check)
else
  SCRIPT_ORDER=(lint lint:fix format format:check typecheck check)
fi

declare -A SCRIPT_VALUES
SCRIPT_VALUES[lint]="oxlint --type-aware ."
SCRIPT_VALUES[lint:fix]="oxlint --type-aware --fix ."
SCRIPT_VALUES[format]="oxfmt . && dprint fmt"
SCRIPT_VALUES[format:check]="oxfmt --check . && dprint check"
SCRIPT_VALUES[typecheck]="tsc --noEmit"
SCRIPT_VALUES[check]="oxlint --type-aware . && oxfmt --check . && dprint check && tsc --noEmit"

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
if [[ $SKIP_OXC == true ]]; then
  # Skip oxc scripts, only add dprint/tsc scripts
  jq '
    .scripts = .scripts // {} |
    .scripts.format            //= "dprint fmt" |
    .scripts["format:check"]   //= "dprint check" |
    .scripts.typecheck         //= "tsc --noEmit" |
    .scripts.check             //= "dprint check && tsc --noEmit"
  ' package.json > package.json.tmp && mv package.json.tmp package.json
else
  jq '
    .scripts = .scripts // {} |
    .scripts.lint              //= "oxlint --type-aware ." |
    .scripts["lint:fix"]       //= "oxlint --type-aware --fix ." |
    .scripts.format            //= "oxfmt . && dprint fmt" |
    .scripts["format:check"]   //= "oxfmt --check . && dprint check" |
    .scripts.typecheck         //= "tsc --noEmit" |
    .scripts.check             //= "oxlint --type-aware . && oxfmt --check . && dprint check && tsc --noEmit"
  ' package.json > package.json.tmp && mv package.json.tmp package.json
fi

# ── install devDependencies ──────────────────────────────
NEED=()
if [[ $SKIP_OXC == true ]]; then
  # Skip oxc dependencies, only install dprint and typescript
  DEPS_TO_CHECK=(dprint typescript)
else
  DEPS_TO_CHECK=(oxlint oxfmt dprint typescript)
fi

for dep in "${DEPS_TO_CHECK[@]}"; do
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
  COMMIT_FILES+=("package.json")
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
  
  # Stage only tracked files
  if [[ ${#COMMIT_FILES[@]} -gt 0 ]]; then
    STAGED_FILES=()
    for f in "${COMMIT_FILES[@]}"; do
      if git ls-files --error-unmatch "$f" &>/dev/null || [[ -f "$f" ]]; then
        git add "$f" 2>/dev/null && STAGED_FILES+=("$f")
      fi
    done
    
    # Only commit if there are staged changes
    if [[ ${#STAGED_FILES[@]} -gt 0 ]] && ! git diff --cached --quiet; then
      COMMIT_MSG=$(cat <<'EOF'
🎨 style: bootstrap code-style tooling

Add strict TypeScript + OXC linting/formatting configuration

- Install oxlint, oxfmt, dprint, typescript
- Configure tsconfig with strict mode + noUncheckedIndexedAccess
- Add lint, format, typecheck, and check scripts
- Set up .gitignore entries (node_modules, dist, *.tsbuildinfo)
- Enforce single quotes, no semicolons, 100 char line width

Tooling: oxlint (--type-aware) + oxfmt + dprint + tsc
EOF
)
      git commit -m "$COMMIT_MSG" --quiet
      info "committed code-style setup ($(echo "${STAGED_FILES[*]}" | tr ' ' ', '))"
    fi
  fi
fi

# ── recap ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Code Style Init — Recap"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
printf '  %-18s %s\n' "Package manager:" "$PM_DETECTED"
printf '  %-18s %s\n' "Git:"             "$GIT_STATE"
if [[ $SKIP_OXC == true ]]; then
  printf '  %-18s %s\n' "OXC:"            "skipped (using existing tooling)"
elif [[ "$OXC_MODE" == "replace" ]]; then
  printf '  %-18s %s\n' "OXC:"            "replaced with skill rules"
elif [[ "$OXC_MODE" == "merge" ]]; then
  printf '  %-18s %s\n' "OXC:"            "merged with skill rules"
fi
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

# Tool conflicts
if [[ ${#TOOLS_REMOVED[@]} -gt 0 || ${#TOOLS_WARNED[@]} -gt 0 ]]; then
  echo "  Tool conflicts:"
  for tool in "${TOOLS_REMOVED[@]}"; do printf '    ✗ %-22s removed\n'  "$tool"; done
  for tool in "${TOOLS_WARNED[@]}"; do printf '    ⚠ %-22s warning\n'   "$tool"; done
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
