"""CLI for the token analytics plugin."""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

_hermes_constants = None
try:  # pragma: no cover - exercised in a real Hermes runtime
    _hermes_constants = importlib.import_module("hermes_constants")
except ImportError:  # pragma: no cover - fallback for source-repo testing outside Hermes
    pass

if _hermes_constants is not None:
    display_hermes_home = _hermes_constants.display_hermes_home
    get_hermes_home = _hermes_constants.get_hermes_home
else:
    def get_hermes_home() -> Path:
        return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()

    def display_hermes_home() -> str:
        return str(get_hermes_home())

DEFAULT_DB_TIMEOUT = 30.0
DEFAULT_DAYS_BACK = 30
DEFAULT_ENVIRONMENT = "production"
DEFAULT_WORKSPACE_NAME = "Hermes Usage"
DEFAULT_WORKSPACE_SLUG = "hermes-usage"
DEFAULT_SOURCE_LABEL = "Hermes token analytics plugin"
DEFAULT_ENDPOINT_PATH = "/api/ingest/hermes-usage"
SHARED_SECRET_ENV_VAR = "HERMES_TOKEN_ANALYTICS_SHARED_SECRET"
LEGACY_SHARED_SECRET_ENV_VAR = "HERMES_TOKEN_ANALYTICS_TOKEN"
HOUSTON_TIME_ZONE = ZoneInfo("America/Chicago")

DEFAULT_USER_AGENT = "hermes-token-analytics/1.0"


@dataclass
class TokenAnalyticsConfig:
    db_path: Path
    db_timeout: float
    endpoint: str
    shared_secret: str
    workspace_slug: str
    workspace_name: str
    environment: str
    days_back: int
    source_label: str = DEFAULT_SOURCE_LABEL


@dataclass
class DoctorReport:
    ok: bool
    issues: list[str]
    warnings: list[str]
    db_exists: bool
    db_readable: bool
    db_path: str
    endpoint_configured: bool
    shared_secret_configured: bool
    session_count: int | None
    sessions_in_window: int | None
    oldest_session_at: str | None
    newest_session_at: str | None


def register_cli(subparser: argparse.ArgumentParser) -> None:
    subs = subparser.add_subparsers(dest="token_analytics_action")

    sync_p = subs.add_parser("sync", help="Build and optionally POST token analytics rollups")
    _add_common_config_args(sync_p)
    sync_p.add_argument("--dry-run", action="store_true", help="Print payload instead of posting it")
    sync_p.add_argument("--verbose", action="store_true", help="Print sync response details")

    doctor_p = subs.add_parser("doctor", help="Validate token analytics config and state.db access")
    _add_common_config_args(doctor_p)
    doctor_p.add_argument("--json", action="store_true", help="Emit machine-readable JSON")

    show_p = subs.add_parser("show-config", help="Show effective token analytics config with secrets masked")
    _add_common_config_args(show_p)
    show_p.add_argument("--json", action="store_true", help="Emit machine-readable JSON")

    wrapper_p = subs.add_parser(
        "install-cron-wrapper",
        help="Install a thin shell wrapper for Hermes cron no_agent jobs",
    )
    wrapper_p.add_argument(
        "--path",
        default=str(get_hermes_home() / "scripts" / "token_analytics_sync.sh"),
        help="Where to write the wrapper script",
    )
    wrapper_p.add_argument("--force", action="store_true", help="Overwrite an existing wrapper")

    subparser.set_defaults(func=token_analytics_command)


def _add_common_config_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--db-path",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_DB_PATH", str(get_hermes_home() / "state.db")),
        help="Path to Hermes state.db (default: HERMES_TOKEN_ANALYTICS_DB_PATH or ~/.hermes/state.db)",
    )
    parser.add_argument(
        "--db-timeout",
        type=float,
        default=_env_float("HERMES_TOKEN_ANALYTICS_DB_TIMEOUT", DEFAULT_DB_TIMEOUT),
        help="SQLite connect timeout in seconds",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_ENDPOINT", ""),
        help="Analytics ingest endpoint URL",
    )
    parser.add_argument(
        "--shared-secret",
        "--token",
        dest="shared_secret",
        default=_shared_secret_from_env(),
        help=(
            "Shared secret for analytics ingest "
            f"(default: {SHARED_SECRET_ENV_VAR}; legacy {LEGACY_SHARED_SECRET_ENV_VAR} also accepted)"
        ),
    )
    parser.add_argument(
        "--workspace-slug",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_WORKSPACE_SLUG", DEFAULT_WORKSPACE_SLUG),
        help="Workspace slug attached to exported rollups",
    )
    parser.add_argument(
        "--workspace-name",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_WORKSPACE_NAME", DEFAULT_WORKSPACE_NAME),
        help="Workspace name attached to exported rollups",
    )
    parser.add_argument(
        "--environment",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_ENVIRONMENT", DEFAULT_ENVIRONMENT),
        help="Environment label for exported rollups",
    )
    parser.add_argument(
        "--days-back",
        type=int,
        default=_env_int("HERMES_TOKEN_ANALYTICS_DAYS_BACK", DEFAULT_DAYS_BACK),
        help="Days of history to aggregate (1-365)",
    )
    parser.add_argument(
        "--source-label",
        default=os.environ.get("HERMES_TOKEN_ANALYTICS_SOURCE_LABEL", DEFAULT_SOURCE_LABEL),
        help=argparse.SUPPRESS,
    )


def token_analytics_command(args: argparse.Namespace) -> int:
    action = getattr(args, "token_analytics_action", None)
    if not action:
        print("Usage: hermes token-analytics {sync|doctor|show-config}")
        return 2

    config = _config_from_args(args)

    if action == "sync":
        return _cmd_sync(config, dry_run=bool(getattr(args, "dry_run", False)), verbose=bool(getattr(args, "verbose", False)))
    if action == "doctor":
        return _cmd_doctor(config, as_json=bool(getattr(args, "json", False)))
    if action == "show-config":
        return _cmd_show_config(config, as_json=bool(getattr(args, "json", False)))
    if action == "install-cron-wrapper":
        return _cmd_install_cron_wrapper(
            Path(str(getattr(args, "path", "") or "")).expanduser(),
            force=bool(getattr(args, "force", False)),
        )

    print(f"Unknown token-analytics action: {action}")
    return 2


def _config_from_args(args: argparse.Namespace) -> TokenAnalyticsConfig:
    endpoint = _normalize_endpoint(str(getattr(args, "endpoint", "") or "").strip())
    return TokenAnalyticsConfig(
        db_path=Path(str(getattr(args, "db_path", "") or "")).expanduser(),
        db_timeout=max(0.1, float(getattr(args, "db_timeout", DEFAULT_DB_TIMEOUT) or DEFAULT_DB_TIMEOUT)),
        endpoint=endpoint,
        shared_secret=str(getattr(args, "shared_secret", "") or "").strip(),
        workspace_slug=_coalesce(str(getattr(args, "workspace_slug", "") or "").strip(), DEFAULT_WORKSPACE_SLUG),
        workspace_name=_coalesce(str(getattr(args, "workspace_name", "") or "").strip(), DEFAULT_WORKSPACE_NAME),
        environment=_coalesce(str(getattr(args, "environment", "") or "").strip(), DEFAULT_ENVIRONMENT),
        days_back=max(1, min(365, int(getattr(args, "days_back", DEFAULT_DAYS_BACK) or DEFAULT_DAYS_BACK))),
        source_label=_coalesce(str(getattr(args, "source_label", "") or "").strip(), DEFAULT_SOURCE_LABEL),
    )


def _cmd_sync(config: TokenAnalyticsConfig, *, dry_run: bool, verbose: bool) -> int:
    report = diagnose_config(config, require_ingest=True)
    if not report.ok:
        _print_doctor_report(report, as_json=False)
        return 1

    payload = build_payload(config)
    if dry_run:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0

    response = post_payload(config, payload)
    summary = {
        "ok": True,
        "endpoint": config.endpoint,
        "days_back": config.days_back,
        "rollup_count": len(payload.get("rollups") or []),
        "response": response if verbose else _summarize_response(response),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


def _cmd_doctor(config: TokenAnalyticsConfig, *, as_json: bool) -> int:
    report = diagnose_config(config, require_ingest=False)
    if as_json:
        print(json.dumps(asdict(report), indent=2, sort_keys=True))
    else:
        _print_doctor_report(report, as_json=False)
    return 0 if report.ok else 1


def _cmd_show_config(config: TokenAnalyticsConfig, *, as_json: bool) -> int:
    snapshot = render_config_snapshot(config)
    if as_json:
        print(json.dumps(snapshot, indent=2, sort_keys=True))
    else:
        print("[token-analytics config]")
        print(json.dumps(snapshot, indent=2, sort_keys=True))
    return 0


def _cmd_install_cron_wrapper(path: Path, *, force: bool) -> int:
    created = install_cron_wrapper(path, force=force)
    print(
        json.dumps(
            {
                "ok": True,
                "path": str(created),
                "usage": (
                    "hermes cron create 'every 15m' --name 'token-analytics-sync' "
                    f"--script {created.name} --no-agent"
                ),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def diagnose_config(config: TokenAnalyticsConfig, *, require_ingest: bool) -> DoctorReport:
    issues: list[str] = []
    warnings: list[str] = []

    db_exists = config.db_path.exists()
    db_readable = False
    session_count: int | None = None
    sessions_in_window: int | None = None
    oldest_session_at: str | None = None
    newest_session_at: str | None = None

    if not db_exists:
        issues.append(
            f"state.db not found at {config.db_path}. Set HERMES_TOKEN_ANALYTICS_DB_PATH or pass --db-path."
        )
    else:
        try:
            db_readable = True
            with _connect_db(config) as conn:
                session_count = _fetch_scalar(conn, "SELECT COUNT(*) FROM sessions")
                cutoff = datetime.now(HOUSTON_TIME_ZONE).date() - timedelta(days=config.days_back - 1)
                sessions_in_window = _fetch_scalar(
                    conn,
                    """
                    SELECT COUNT(*)
                    FROM sessions
                    WHERE started_at IS NOT NULL
                      AND COALESCE(ended_at, started_at) >= ?
                    """,
                    (datetime.combine(cutoff, datetime.min.time(), tzinfo=HOUSTON_TIME_ZONE).astimezone(timezone.utc).timestamp(),),
                )
                oldest = conn.execute(
                    "SELECT MIN(COALESCE(ended_at, started_at)) FROM sessions WHERE started_at IS NOT NULL"
                ).fetchone()
                newest = conn.execute(
                    "SELECT MAX(COALESCE(ended_at, started_at)) FROM sessions WHERE started_at IS NOT NULL"
                ).fetchone()
                oldest_session_at = _ts_to_iso(oldest[0] if oldest else None)
                newest_session_at = _ts_to_iso(newest[0] if newest else None)
        except sqlite3.Error as exc:
            db_readable = False
            issues.append(f"Unable to read state.db: {exc}")

    endpoint_configured = bool(config.endpoint)
    shared_secret_configured = bool(config.shared_secret)
    if require_ingest or endpoint_configured:
        if not endpoint_configured:
            issues.append(
                f"HERMES_TOKEN_ANALYTICS_ENDPOINT is required. Expected ingest route like https://example.com{DEFAULT_ENDPOINT_PATH}."
            )
        elif not config.endpoint.startswith(("http://", "https://")):
            issues.append("Ingest endpoint must start with http:// or https://")

    if require_ingest or shared_secret_configured:
        if not shared_secret_configured:
            issues.append(
                f"{SHARED_SECRET_ENV_VAR} is required for sync. Store it in "
                f"{display_hermes_home()}/.env or pass --shared-secret. "
                f"Legacy {LEGACY_SHARED_SECRET_ENV_VAR} is still accepted."
            )

    if config.days_back > 90:
        warnings.append("days_back above 90 may create larger payloads than you need.")
    if db_readable and session_count == 0:
        warnings.append("state.db is readable but has no sessions yet.")
    if db_readable and sessions_in_window == 0:
        warnings.append(f"No sessions found in the last {config.days_back} day(s).")

    return DoctorReport(
        ok=not issues,
        issues=issues,
        warnings=warnings,
        db_exists=db_exists,
        db_readable=db_readable,
        db_path=str(config.db_path),
        endpoint_configured=endpoint_configured,
        shared_secret_configured=shared_secret_configured,
        session_count=session_count,
        sessions_in_window=sessions_in_window,
        oldest_session_at=oldest_session_at,
        newest_session_at=newest_session_at,
    )


def render_config_snapshot(config: TokenAnalyticsConfig) -> dict[str, Any]:
    return {
        "db_path": str(config.db_path),
        "db_timeout": config.db_timeout,
        "endpoint": config.endpoint,
        "shared_secret": _mask_secret(config.shared_secret),
        "shared_secret_configured": bool(config.shared_secret),
        "workspace_slug": config.workspace_slug,
        "workspace_name": config.workspace_name,
        "environment": config.environment,
        "days_back": config.days_back,
        "source_label": config.source_label,
    }


def build_payload(config: TokenAnalyticsConfig) -> dict[str, Any]:
    hourly_now = _utc_now()
    with _connect_db(config) as connection:
        connection.row_factory = sqlite3.Row
        rollups = [
            *fetch_daily_rollups(connection, config.days_back),
            *fetch_hourly_rollups(connection, now=hourly_now),
        ]
        models = [
            *fetch_model_rollups(connection, config.days_back),
            *fetch_hourly_model_rollups(connection, now=hourly_now),
        ]

    models_by_day: dict[str, list[dict[str, Any]]] = {}
    for row in models:
        models_by_day.setdefault(str(row["usage_date"]), []).append(
            {
                "model": row["model"] or "unknown-model",
                "requests": int(row["api_calls"] or 0),
                "tokens": int(row["total_tokens"] or 0),
                "estimatedCostUsd": round(float(row["cost_usd"] or 0), 4),
            }
        )

    payload_rollups: list[dict[str, Any]] = []
    for row in sorted(rollups, key=lambda item: str(item["usage_date"])):
        usage_date = str(row["usage_date"])
        payload_rollups.append(
            {
                "usageDate": usage_date,
                "requests": int(row["api_calls"] or 0),
                "totalTokens": int(row["total_tokens"] or 0),
                "inputTokens": int(row["input_tokens"] or 0),
                "outputTokens": int(row["output_tokens"] or 0),
                "cachedTokens": int(row["cached_tokens"] or 0),
                "reasoningTokens": int(row["reasoning_tokens"] or 0),
                "estimatedCostUsd": round(float(row["cost_usd"] or 0), 4),
                "models": models_by_day.get(usage_date, []),
            }
        )

    return {
        "environment": config.environment,
        "generatedAt": _iso_now(),
        "sourceLabel": config.source_label,
        "workspace": {
            "name": config.workspace_name,
            "provider": "Hermes",
            "slug": config.workspace_slug,
        },
        "rollups": payload_rollups,
    }


def fetch_daily_rollups(connection: sqlite3.Connection, days_back: int) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back + 2)
    rows = _fetch_session_metrics(connection, since=cutoff.timestamp())
    cutoff_day = datetime.now(timezone.utc).date() - timedelta(days=days_back - 1)
    return _aggregate_usage_rows(
        rows,
        key_fn=lambda session: _session_utc_day(session["session_ts"]),
        include_model=False,
        predicate=lambda session: _session_utc_day(session["session_ts"]) >= cutoff_day.isoformat(),
    )


def fetch_model_rollups(connection: sqlite3.Connection, days_back: int) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back + 2)
    rows = _fetch_session_metrics(connection, since=cutoff.timestamp())
    cutoff_day = datetime.now(timezone.utc).date() - timedelta(days=days_back - 1)
    return _aggregate_usage_rows(
        rows,
        key_fn=lambda session: _session_utc_day(session["session_ts"]),
        include_model=True,
        predicate=lambda session: _session_utc_day(session["session_ts"]) >= cutoff_day.isoformat(),
    )


def fetch_hourly_rollups(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = _fetch_session_metrics(connection, since=cutoff.timestamp())
    return _aggregate_usage_rows(
        rows,
        key_fn=lambda session: _session_utc_hour(session["session_ts"]),
        include_model=False,
    )


def fetch_hourly_model_rollups(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = _fetch_session_metrics(connection, since=cutoff.timestamp())
    return _aggregate_usage_rows(
        rows,
        key_fn=lambda session: _session_utc_hour(session["session_ts"]),
        include_model=True,
    )


def _fetch_session_metrics(connection: sqlite3.Connection, *, since: float | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT
            COALESCE(ended_at, started_at) AS session_ts,
            COALESCE(NULLIF(model, ''), 'unknown-model') AS model,
            COALESCE(api_call_count, 0) AS api_calls,
            COALESCE(input_tokens, 0) AS input_tokens,
            COALESCE(output_tokens, 0) AS output_tokens,
            COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0) AS cached_tokens,
            COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
            COALESCE(actual_cost_usd, estimated_cost_usd, 0) AS cost_usd
        FROM sessions
        WHERE started_at IS NOT NULL
    """
    params: tuple[Any, ...] = ()
    if since is not None:
        query += " AND COALESCE(ended_at, started_at) >= ?"
        params = (since,)
    query += " ORDER BY session_ts ASC"
    return [dict(row) for row in connection.execute(query, params)]


def _aggregate_usage_rows(
    rows: list[dict[str, Any]],
    *,
    key_fn,
    include_model: bool,
    predicate=None,
) -> list[dict[str, Any]]:
    aggregated: dict[tuple[str, ...], dict[str, Any]] = {}
    for row in rows:
        if predicate and not predicate(row):
            continue
        usage_date = key_fn(row)
        key = (usage_date, str(row["model"])) if include_model else (usage_date,)
        bucket = aggregated.setdefault(
            key,
            {
                "usage_date": usage_date,
                "model": str(row["model"]),
                "api_calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cached_tokens": 0,
                "reasoning_tokens": 0,
                "total_tokens": 0,
                "cost_usd": 0.0,
            },
        )
        bucket["api_calls"] += int(row["api_calls"] or 0)
        bucket["input_tokens"] += int(row["input_tokens"] or 0)
        bucket["output_tokens"] += int(row["output_tokens"] or 0)
        bucket["cached_tokens"] += int(row["cached_tokens"] or 0)
        bucket["reasoning_tokens"] += int(row["reasoning_tokens"] or 0)
        bucket["total_tokens"] += int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0) + int(row["cached_tokens"] or 0) + int(row["reasoning_tokens"] or 0)
        bucket["cost_usd"] += float(row["cost_usd"] or 0)

    sort_key = (lambda item: (item["usage_date"], -item["total_tokens"], item["model"])) if include_model else (lambda item: item["usage_date"])
    results = sorted(aggregated.values(), key=sort_key)
    if not include_model:
        for item in results:
            item.pop("model", None)
    return results


def fetch_hourly_rollups(
    connection: sqlite3.Connection,
    *,
    hours: int = 24,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    if hours <= 0:
        return []

    current_hour = _truncate_to_hour(now or _utc_now())
    window_start = current_hour - timedelta(hours=hours - 1)
    window_end = current_hour + timedelta(hours=1)
    query = """
        WITH scoped_sessions AS (
            SELECT
                strftime('%Y-%m-%dT%H:00:00Z', COALESCE(ended_at, started_at), 'unixepoch') AS usage_date,
                COALESCE(api_call_count, 0) AS api_calls,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0) AS cached_tokens,
                COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
                COALESCE(actual_cost_usd, estimated_cost_usd, 0) AS cost_usd
            FROM sessions
            WHERE started_at IS NOT NULL
              AND COALESCE(ended_at, started_at) >= ?
              AND COALESCE(ended_at, started_at) < ?
        )
        SELECT
            usage_date,
            SUM(api_calls) AS api_calls,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cached_tokens) AS cached_tokens,
            SUM(reasoning_tokens) AS reasoning_tokens,
            SUM(input_tokens + output_tokens + cached_tokens + reasoning_tokens) AS total_tokens,
            SUM(cost_usd) AS cost_usd
        FROM scoped_sessions
        GROUP BY usage_date
        ORDER BY usage_date ASC
    """
    return [
        _normalize_rollup_row(row)
        for row in connection.execute(query, (int(window_start.timestamp()), int(window_end.timestamp())))
    ]


def fetch_hourly_model_rollups(
    connection: sqlite3.Connection,
    *,
    hours: int = 24,
    now: datetime | None = None,
) -> list[sqlite3.Row]:
    if hours <= 0:
        return []

    current_hour = _truncate_to_hour(now or _utc_now())
    window_start = current_hour - timedelta(hours=hours - 1)
    window_end = current_hour + timedelta(hours=1)
    query = """
        WITH scoped_sessions AS (
            SELECT
                strftime('%Y-%m-%dT%H:00:00Z', COALESCE(ended_at, started_at), 'unixepoch') AS usage_date,
                COALESCE(NULLIF(model, ''), 'unknown-model') AS model,
                COALESCE(api_call_count, 0) AS api_calls,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0) AS cached_tokens,
                COALESCE(reasoning_tokens, 0) AS reasoning_tokens,
                COALESCE(actual_cost_usd, estimated_cost_usd, 0) AS cost_usd
            FROM sessions
            WHERE started_at IS NOT NULL
              AND COALESCE(ended_at, started_at) >= ?
              AND COALESCE(ended_at, started_at) < ?
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
    return list(connection.execute(query, (int(window_start.timestamp()), int(window_end.timestamp()))))


def _normalize_rollup_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "usage_date": str(row["usage_date"]),
        "api_calls": int(row["api_calls"] or 0),
        "input_tokens": int(row["input_tokens"] or 0),
        "output_tokens": int(row["output_tokens"] or 0),
        "cached_tokens": int(row["cached_tokens"] or 0),
        "reasoning_tokens": int(row["reasoning_tokens"] or 0),
        "total_tokens": int(row["total_tokens"] or 0),
        "cost_usd": float(row["cost_usd"] or 0),
    }


def post_payload(config: TokenAnalyticsConfig, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        config.endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.shared_secret}",
            "Content-Type": "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=config.db_timeout) as response:
            body = response.read().decode("utf-8")
            if not body:
                return {"status": response.status}
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"status": response.status, "body": body}
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"ingest failed with HTTP {error.code}: {details}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"ingest failed: {error.reason}") from error


def install_cron_wrapper(path: Path, *, force: bool) -> Path:
    target = path.expanduser()
    if target.exists() and not force:
        raise SystemExit(f"wrapper already exists at {target}; rerun with --force to overwrite")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n\n"
        "exec hermes token-analytics sync \"$@\"\n",
        encoding="utf-8",
    )
    os.chmod(target, 0o755)
    return target


def _connect_db(config: TokenAnalyticsConfig) -> sqlite3.Connection:
    return sqlite3.connect(
        f"file:{config.db_path.as_posix()}?mode=ro",
        uri=True,
        timeout=config.db_timeout,
    )


def _fetch_scalar(connection: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> int | None:
    row = connection.execute(query, params).fetchone()
    if not row:
        return None
    value = row[0]
    return int(value) if value is not None else None


def _print_doctor_report(report: DoctorReport, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(asdict(report), indent=2, sort_keys=True))
        return
    print("[token-analytics doctor]")
    print(f"  ok: {'yes' if report.ok else 'no'}")
    print(f"  db_path: {report.db_path}")
    print(f"  db_exists: {'yes' if report.db_exists else 'no'}")
    print(f"  db_readable: {'yes' if report.db_readable else 'no'}")
    print(f"  endpoint_configured: {'yes' if report.endpoint_configured else 'no'}")
    print(f"  shared_secret_configured: {'yes' if report.shared_secret_configured else 'no'}")
    if report.session_count is not None:
        print(f"  session_count: {report.session_count}")
    if report.sessions_in_window is not None:
        print(f"  sessions_in_window: {report.sessions_in_window}")
    if report.oldest_session_at:
        print(f"  oldest_session_at: {report.oldest_session_at}")
    if report.newest_session_at:
        print(f"  newest_session_at: {report.newest_session_at}")
    if report.issues:
        print("  issues:")
        for item in report.issues:
            print(f"    - {item}")
    if report.warnings:
        print("  warnings:")
        for item in report.warnings:
            print(f"    - {item}")


def _normalize_endpoint(value: str) -> str:
    return value.rstrip("/") if value else ""


def _summarize_response(response: dict[str, Any]) -> dict[str, Any]:
    summary = dict(response or {})
    if "rollups" in summary and isinstance(summary["rollups"], list):
        summary["rollups"] = f"{len(summary['rollups'])} item(s)"
    return summary


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:4] + ("*" * (len(value) - 8)) + value[-4:]


def _coalesce(value: str, default: str) -> str:
    return value or default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _shared_secret_from_env() -> str:
    return os.environ.get(SHARED_SECRET_ENV_VAR, os.environ.get(LEGACY_SHARED_SECRET_ENV_VAR, "")).strip()


def _session_utc_day(value: Any) -> str:
    return _session_utc_datetime(value).strftime("%Y-%m-%d")


def _session_utc_hour(value: Any) -> str:
    return _session_utc_datetime(value).replace(minute=0, second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def _session_utc_datetime(value: Any) -> datetime:
    return datetime.fromtimestamp(float(value), tz=timezone.utc)


def _iso_now() -> str:
    return _utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _truncate_to_hour(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _ts_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def _build_standalone_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="hermes token-analytics")
    register_cli(parser)
    return parser.parse_args()


if __name__ == "__main__":  # pragma: no cover
    try:
        raise SystemExit(token_analytics_command(_build_standalone_args()))
    except BrokenPipeError:
        sys.exit(1)
