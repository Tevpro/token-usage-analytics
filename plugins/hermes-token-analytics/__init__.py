"""Hermes token analytics plugin for exporting token and cost rollups from state.db.

Activation is handled by the Hermes plugin system. Enable the plugin via
``hermes plugins enable hermes-token-analytics``.

This plugin intentionally loads even when env vars are missing so operators can
use ``hermes token-analytics doctor`` and ``show-config`` before setup is
finished.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

try:
    from .cli import register_cli as _register_token_analytics_cli
    from .cli import token_analytics_command as _token_analytics_command
except ImportError:  # pragma: no cover - fallback for direct file imports in tests/tooling
    _cli_path = Path(__file__).with_name("cli.py")
    _spec = importlib.util.spec_from_file_location("token_analytics_plugin.cli", _cli_path)
    if _spec is None or _spec.loader is None:
        raise RuntimeError(f"Failed to load CLI module from {_cli_path}")
    _module = importlib.util.module_from_spec(_spec)
    sys.modules.setdefault("token_analytics_plugin.cli", _module)
    _spec.loader.exec_module(_module)
    _register_token_analytics_cli = _module.register_cli
    _token_analytics_command = _module.token_analytics_command


def register(ctx) -> None:
    ctx.register_cli_command(
        name="token-analytics",
        help="Export Hermes token usage analytics from state.db",
        setup_fn=_register_token_analytics_cli,
        handler_fn=_token_analytics_command,
        description=(
            "Inspect, validate, and sync Hermes state.db usage rollups to an "
            "external analytics ingest endpoint."
        ),
    )
