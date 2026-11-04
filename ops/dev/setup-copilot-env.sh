#!/usr/bin/env bash
# Configure PD Copilot environment variables for local development.
#
# Writes/updates the COPILOT_* and OPENAI_API_KEY keys in apps/backend/.env, leaving every
# other line in that file untouched. Prompts for the API key unless OPENAI_API_KEY is
# already exported in your shell.
#
#   bash ops/dev/setup-copilot-env.sh                 # interactive
#   OPENAI_API_KEY=sk-... bash ops/dev/setup-copilot-env.sh
#   COPILOT_ENABLED=false bash ops/dev/setup-copilot-env.sh   # write config but keep it off
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/backend/.env"
EXAMPLE_FILE="$REPO_ROOT/apps/backend/.env.local.example"

COPILOT_ENABLED="${COPILOT_ENABLED:-true}"
COPILOT_MODELS="${COPILOT_MODELS:-gpt-6.1-terra,gpt-6.1-sol,gpt-6-luna}"
COPILOT_DEFAULT_MODEL="${COPILOT_DEFAULT_MODEL:-gpt-6.1-terra}"
COPILOT_MAX_TOOL_ITERATIONS="${COPILOT_MAX_TOOL_ITERATIONS:-12}"
COPILOT_REQUEST_TIMEOUT_SECONDS="${COPILOT_REQUEST_TIMEOUT_SECONDS:-180}"
COPILOT_PROXY_RATE_LIMIT_PER_MINUTE="${COPILOT_PROXY_RATE_LIMIT_PER_MINUTE:-60}"

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "error: neither $ENV_FILE nor $EXAMPLE_FILE exists" >&2
    exit 1
  fi
  echo "apps/backend/.env not found; creating it from .env.local.example"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  if [ -t 0 ]; then
    # -s keeps the key off the terminal and out of shell history.
    read -r -s -p "OpenAI API key (leave blank to keep the current value): " OPENAI_API_KEY
    echo
  else
    OPENAI_API_KEY=""
  fi
fi

# Replace the key in place if present, otherwise append it. Values are written via a
# python helper so keys containing regex/sed metacharacters are handled literally.
set_env_var() {
  local key="$1" value="$2"
  KEY="$key" VALUE="$value" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os
import pathlib

key = os.environ["KEY"]
value = os.environ["VALUE"]
path = pathlib.Path(os.environ["ENV_FILE"])

lines = path.read_text().splitlines()
prefix = f"{key}="
replaced = False
for index, line in enumerate(lines):
    if line.startswith(prefix) or line.startswith(f"#{prefix}"):
        lines[index] = f"{prefix}{value}"
        replaced = True
        break
if not replaced:
    lines.append(f"{prefix}{value}")
path.write_text("\n".join(lines) + "\n")
PY
}

if [ -n "${OPENAI_API_KEY:-}" ]; then
  set_env_var OPENAI_API_KEY "$OPENAI_API_KEY"
  echo "  OPENAI_API_KEY                      set (${#OPENAI_API_KEY} chars)"
else
  echo "  OPENAI_API_KEY                      left unchanged"
fi

set_env_var COPILOT_ENABLED "$COPILOT_ENABLED"
set_env_var COPILOT_MODELS "$COPILOT_MODELS"
set_env_var COPILOT_DEFAULT_MODEL "$COPILOT_DEFAULT_MODEL"
set_env_var COPILOT_MAX_TOOL_ITERATIONS "$COPILOT_MAX_TOOL_ITERATIONS"
set_env_var COPILOT_REQUEST_TIMEOUT_SECONDS "$COPILOT_REQUEST_TIMEOUT_SECONDS"
set_env_var COPILOT_PROXY_RATE_LIMIT_PER_MINUTE "$COPILOT_PROXY_RATE_LIMIT_PER_MINUTE"

echo "  COPILOT_ENABLED                     $COPILOT_ENABLED"
echo "  COPILOT_MODELS                      $COPILOT_MODELS"
echo "  COPILOT_DEFAULT_MODEL               $COPILOT_DEFAULT_MODEL"
echo "  COPILOT_MAX_TOOL_ITERATIONS         $COPILOT_MAX_TOOL_ITERATIONS"
echo "  COPILOT_REQUEST_TIMEOUT_SECONDS     $COPILOT_REQUEST_TIMEOUT_SECONDS"
echo "  COPILOT_PROXY_RATE_LIMIT_PER_MINUTE $COPILOT_PROXY_RATE_LIMIT_PER_MINUTE"
echo
echo "Wrote $ENV_FILE (gitignored)."
echo "Next:"
echo "  npm run dev:infra"
echo "  npm run dev"
echo "  open http://localhost:3000/admin/copilot"

if [ "$COPILOT_DEFAULT_MODEL" != "" ] && [[ ",$COPILOT_MODELS," != *",$COPILOT_DEFAULT_MODEL,"* ]]; then
  echo
  echo "warning: COPILOT_DEFAULT_MODEL ($COPILOT_DEFAULT_MODEL) is not in COPILOT_MODELS;" >&2
  echo "         the backend will fall back to the first listed model." >&2
fi
