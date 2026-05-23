#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
TARGET_HERMES_ROOT=${1:-"$HOME/.hermes/hermes-agent"}
TARGET_PLUGIN_DIR="$TARGET_HERMES_ROOT/plugins/observability/token_analytics"
SOURCE_PLUGIN_DIR="$SOURCE_ROOT/plugins/observability/token_analytics"

if [[ ! -d "$SOURCE_PLUGIN_DIR" ]]; then
  echo "source plugin directory not found: $SOURCE_PLUGIN_DIR" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_PLUGIN_DIR")"
rm -rf "$TARGET_PLUGIN_DIR"
cp -R "$SOURCE_PLUGIN_DIR" "$TARGET_PLUGIN_DIR"

echo "Installed token_analytics plugin into: $TARGET_PLUGIN_DIR"
