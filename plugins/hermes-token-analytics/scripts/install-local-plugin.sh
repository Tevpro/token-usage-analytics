#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
TARGET_HERMES_ROOT=${1:-"$HOME/.hermes/hermes-agent"}
TARGET_PLUGIN_DIR="$TARGET_HERMES_ROOT/plugins/hermes-token-analytics"
LEGACY_PLUGIN_DIR="$TARGET_HERMES_ROOT/plugins/observability/token_analytics"

if [[ ! -f "$SOURCE_ROOT/plugin.yaml" || ! -f "$SOURCE_ROOT/__init__.py" ]]; then
  echo "source plugin directory not found or incomplete: $SOURCE_ROOT" >&2
  exit 1
fi

mkdir -p "$TARGET_HERMES_ROOT/plugins" "$(dirname "$LEGACY_PLUGIN_DIR")"
rm -rf "$TARGET_PLUGIN_DIR" "$LEGACY_PLUGIN_DIR"
mkdir -p "$LEGACY_PLUGIN_DIR"
cp -R "$SOURCE_ROOT" "$TARGET_PLUGIN_DIR"

cat > "$LEGACY_PLUGIN_DIR/__init__.py" <<'PY'
"""Compatibility shim for the legacy observability/token_analytics plugin path."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_PLUGIN_DIR = Path(__file__).resolve().parents[2] / "hermes-token-analytics"
_SPEC = importlib.util.spec_from_file_location(
    "hermes_token_analytics_compat",
    _PLUGIN_DIR / "__init__.py",
    submodule_search_locations=[str(_PLUGIN_DIR)],
)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Failed to load Hermes token analytics plugin from {_PLUGIN_DIR}")
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("hermes_token_analytics_compat", _MODULE)
_SPEC.loader.exec_module(_MODULE)
register = _MODULE.register
PY

cat > "$LEGACY_PLUGIN_DIR/plugin.yaml" <<'YAML'
name: token_analytics
version: "0.1.0"
description: "Compatibility shim forwarding observability/token_analytics to hermes-token-analytics."
author: NousResearch
kind: standalone
platforms:
  - linux
  - macos
  - windows
YAML

echo "Installed hermes-token-analytics plugin into: $TARGET_PLUGIN_DIR"
echo "Installed compatibility shim into: $LEGACY_PLUGIN_DIR"
