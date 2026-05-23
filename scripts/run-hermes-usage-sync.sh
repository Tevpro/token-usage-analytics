#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${TOKEN_ANALYTICS_ENV_FILE:-${SCRIPT_DIR}/hermes-usage-sync.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

python3 "$SCRIPT_DIR/export_hermes_usage.py" "$@"
