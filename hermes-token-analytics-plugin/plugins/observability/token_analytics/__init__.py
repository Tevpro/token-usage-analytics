"""token_analytics — Hermes plugin for exporting token/cost rollups from state.db.

Activation is handled by the Hermes plugin system — standalone plugins only
load when listed in ``plugins.enabled`` (via ``hermes plugins enable
observability/token_analytics``).

This plugin intentionally loads even when env vars are missing so operators can
use ``hermes token-analytics doctor`` and ``show-config`` before setup is
finished.
"""
from __future__ import annotations

from plugins.observability.token_analytics.cli import (
    register_cli as _register_token_analytics_cli,
)
from plugins.observability.token_analytics.cli import (
    token_analytics_command as _token_analytics_command,
)


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
