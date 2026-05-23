#!/usr/bin/env python3
"""Aggregate Hermes state.db token usage into daily rollups and push them to the Worker ingest endpoint."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Config:
    db_path: Path
    days_back: int
    endpoint: str
    environment: str
    timeout: int
    token: str
    verbose: bool
    workspace_name: str
    workspace_provider: str
    workspace_slug: str
    dry_run: bool


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", default=os.environ.get("HERMES_STATE_DB", "~/.hermes/state.db"))
    parser.add_argument("--endpoint", default=os.environ.get("TOKEN_ANALYTICS_ENDPOINT", ""))
    parser.add_argument("--token", default=os.environ.get("TOKEN_ANALYTICS_INGEST_TOKEN", ""))
    parser.add_argument("--days-back", type=int, default=int(os.environ.get("TOKEN_ANALYTICS_DAYS_BACK", "30")))
    parser.add_argument(
        "--workspace-name",
        default=os.environ.get("TOKEN_ANALYTICS_WORKSPACE_NAME", "Hermes Usage"),
    )
    parser.add_argument(
        "--workspace-provider",
        default=os.environ.get("TOKEN_ANALYTICS_WORKSPACE_PROVIDER", "Hermes"),
    )
    parser.add_argument(
        "--workspace-slug",
        default=os.environ.get("TOKEN_ANALYTICS_WORKSPACE_SLUG", "hermes-usage"),
    )
    parser.add_argument(
        "--environment",
        default=os.environ.get("TOKEN_ANALYTICS_ENVIRONMENT", "production"),
    )
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("TOKEN_ANALYTICS_TIMEOUT", "30")))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    return Config(
        db_path=Path(args.db_path).expanduser(),
        days_back=max(1, min(args.days_back, 120)),
        endpoint=args.endpoint.strip(),
        environment=args.environment.strip() or "production",
        timeout=max(5, args.timeout),
        token=args.token.strip(),
        verbose=args.verbose,
        workspace_name=args.workspace_name.strip() or "Hermes Usage",
        workspace_provider=args.workspace_provider.strip() or "Hermes",
        workspace_slug=args.workspace_slug.strip() or "hermes-usage",
        dry_run=args.dry_run,
    )


def main() -> int:
    config = parse_args()
    validate_config(config)

    payload = build_payload(config)
    if config.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    response = post_payload(config, payload)
    if config.verbose:
        print(json.dumps(response, indent=2))
    return 0


def validate_config(config: Config) -> None:
    if not config.db_path.exists():
        raise SystemExit(f"state.db not found at {config.db_path}")
    if not config.endpoint:
        raise SystemExit("TOKEN_ANALYTICS_ENDPOINT is required")
    if not config.token:
        raise SystemExit("TOKEN_ANALYTICS_INGEST_TOKEN is required")


def build_payload(config: Config) -> dict[str, Any]:
    with sqlite3.connect(config.db_path) as connection:
        connection.row_factory = sqlite3.Row
        rollups = fetch_daily_rollups(connection, config.days_back)
        models = fetch_model_rollups(connection, config.days_back)

    models_by_day: dict[str, list[dict[str, Any]]] = {}
    for row in models:
        models_by_day.setdefault(row["usage_date"], []).append(
            {
                "estimatedCostUsd": round(float(row["cost_usd"] or 0), 4),
                "model": row["model"] or "unknown-model",
                "provider": config.workspace_provider,
                "requests": int(row["api_calls"] or 0),
                "tokens": int(row["total_tokens"] or 0),
            }
        )

    payload_rollups: list[dict[str, Any]] = []
    for row in rollups:
        usage_date = row["usage_date"]
        payload_rollups.append(
            {
                "usageDate": usage_date,
                "requests": int(row["api_calls"] or 0),
                "totalTokens": int(row["total_tokens"] or 0),
                "inputTokens": int(row["input_tokens"] or 0),
                "outputTokens": int(row["output_tokens"] or 0),
                "cachedTokens": int(row["cached_tokens"] or 0),
                "estimatedCostUsd": round(float(row["cost_usd"] or 0), 4),
                "models": models_by_day.get(usage_date, []),
            }
        )

    return {
        "environment": config.environment,
        "generatedAt": iso_now(),
        "sourceLabel": "Hermes state.db sidecar",
        "workspace": {
            "name": config.workspace_name,
            "provider": config.workspace_provider,
            "slug": config.workspace_slug,
        },
        "rollups": payload_rollups,
    }


def fetch_daily_rollups(connection: sqlite3.Connection, days_back: int) -> list[sqlite3.Row]:
    query = """
        WITH scoped_sessions AS (
            SELECT
                date(COALESCE(ended_at, started_at), 'unixepoch', 'localtime') AS usage_date,
                COALESCE(api_call_count, 0) AS api_calls,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(cache_creation_input_tokens, 0) + COALESCE(cache_read_input_tokens, 0) AS cached_tokens,
                COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
                COALESCE(actual_cost_usd, estimated_cost_usd, 0) AS cost_usd
            FROM sessions
            WHERE started_at IS NOT NULL
              AND date(COALESCE(ended_at, started_at), 'unixepoch', 'localtime') >= date('now', 'localtime', ?)
        )
        SELECT
            usage_date,
            SUM(api_calls) AS api_calls,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cached_tokens) AS cached_tokens,
            SUM(input_tokens + output_tokens + cached_tokens + reasoning_tokens) AS total_tokens,
            SUM(cost_usd) AS cost_usd
        FROM scoped_sessions
        GROUP BY usage_date
        ORDER BY usage_date ASC
    """
    return list(connection.execute(query, (f"-{days_back - 1} days",)))


def fetch_model_rollups(connection: sqlite3.Connection, days_back: int) -> list[sqlite3.Row]:
    query = """
        WITH scoped_sessions AS (
            SELECT
                date(COALESCE(ended_at, started_at), 'unixepoch', 'localtime') AS usage_date,
                COALESCE(NULLIF(model, ''), 'unknown-model') AS model,
                COALESCE(api_call_count, 0) AS api_calls,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(cache_creation_input_tokens, 0) + COALESCE(cache_read_input_tokens, 0) AS cached_tokens,
                COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
                COALESCE(actual_cost_usd, estimated_cost_usd, 0) AS cost_usd
            FROM sessions
            WHERE started_at IS NOT NULL
              AND date(COALESCE(ended_at, started_at), 'unixepoch', 'localtime') >= date('now', 'localtime', ?)
        )
        SELECT
            usage_date,
            model,
            SUM(api_calls) AS api_calls,
            SUM(input_tokens + output_tokens + cached_tokens + reasoning_tokens) AS total_tokens,
            SUM(cost_usd) AS cost_usd
        FROM scoped_sessions
        GROUP BY usage_date, model
        ORDER BY usage_date ASC, total_tokens DESC, model ASC
    """
    return list(connection.execute(query, (f"-{days_back - 1} days",)))


def post_payload(config: Config, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        config.endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=config.timeout) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {"status": response.status}
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"ingest failed with HTTP {error.code}: {details}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"ingest failed: {error.reason}") from error


def iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        sys.exit(1)
