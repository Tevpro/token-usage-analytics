from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path


def _load_plugin_modules():
    repo_root = Path(__file__).resolve().parents[3]
    plugin_dir = repo_root / "plugins" / "hermes-token-analytics"
    package_name = "token_analytics_plugin"

    sys.modules.pop(package_name, None)
    sys.modules.pop(f"{package_name}.cli", None)

    spec = importlib.util.spec_from_file_location(
        package_name,
        plugin_dir / "__init__.py",
        submodule_search_locations=[str(plugin_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load plugin package from {plugin_dir}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[package_name] = module
    spec.loader.exec_module(module)

    cli_module = sys.modules[f"{package_name}.cli"]
    return module, cli_module


_plugin, _cli = _load_plugin_modules()
register = _plugin.register
TokenAnalyticsConfig = _cli.TokenAnalyticsConfig
build_payload = _cli.build_payload
diagnose_config = _cli.diagnose_config
install_cron_wrapper = _cli.install_cron_wrapper
post_payload = _cli.post_payload
render_config_snapshot = _cli.render_config_snapshot


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT,
            model TEXT,
            started_at REAL,
            ended_at REAL,
            api_call_count INTEGER DEFAULT 0,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,
            reasoning_tokens INTEGER DEFAULT 0,
            estimated_cost_usd REAL,
            actual_cost_usd REAL
        )
        """
    )
    rows = [
        (
            "s1",
            "slack",
            "gpt-5.4",
            1763510400.0,
            1763512200.0,
            3,
            100,
            40,
            20,
            10,
            5,
            1.25,
            None,
        ),
        (
            "s2",
            "cli",
            "claude-sonnet-4",
            1763514000.0,
            1763515800.0,
            2,
            50,
            30,
            0,
            5,
            0,
            0.75,
            0.5,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO sessions (
            id, source, model, started_at, ended_at, api_call_count,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, estimated_cost_usd, actual_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    conn.close()


def _config(db_path: Path) -> TokenAnalyticsConfig:
    return TokenAnalyticsConfig(
        db_path=db_path,
        db_timeout=1.0,
        endpoint="https://analytics.example.com/api/ingest/hermes-usage",
        token="secret-token-value",
        workspace_slug="tevpro-hermes",
        workspace_name="Tevpro Hermes",
        environment="production",
        days_back=365,
    )


def test_register_exposes_token_analytics_cli_command():
    class _Ctx:
        def __init__(self):
            self.calls = []

        def register_cli_command(self, **kwargs):
            self.calls.append(kwargs)

    ctx = _Ctx()
    register(ctx)
    assert len(ctx.calls) == 1
    call = ctx.calls[0]
    assert call["name"] == "token-analytics"
    assert call["handler_fn"].__name__ == "token_analytics_command"


def test_build_payload_aggregates_tokens_costs_and_models(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    payload = build_payload(_config(db_path))

    assert payload["workspace"]["slug"] == "tevpro-hermes"
    assert payload["environment"] == "production"

    daily_rollups = [row for row in payload["rollups"] if "T" not in row["usageDate"]]
    assert len(daily_rollups) == 1

    day = daily_rollups[0]
    assert day["requests"] == 5
    assert day["inputTokens"] == 150
    assert day["outputTokens"] == 70
    assert day["cachedTokens"] == 35
    assert day["reasoningTokens"] == 5
    assert day["totalTokens"] == 260
    assert day["estimatedCostUsd"] == 1.75
    assert [model["model"] for model in day["models"]] == ["gpt-5.4", "claude-sonnet-4"]
    assert day["models"][0]["tokens"] == 175
    assert day["models"][1]["estimatedCostUsd"] == 0.5


def test_build_payload_emits_zero_value_hourly_rollups_for_idle_hours(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    fixed_now = _cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)

    payload = build_payload(_config(db_path))

    hourly_rollups = [row for row in payload["rollups"] if "T" in row["usageDate"]]
    assert len(hourly_rollups) == 24

    hourly_by_usage_date = {row["usageDate"]: row for row in hourly_rollups}

    midnight_hour = hourly_by_usage_date["2025-11-19T00:00:00Z"]
    assert midnight_hour["requests"] == 3
    assert midnight_hour["totalTokens"] == 175
    assert midnight_hour["models"] == [
        {
            "estimatedCostUsd": 1.25,
            "model": "gpt-5.4",
            "requests": 3,
            "tokens": 175,
        }
    ]

    one_am_hour = hourly_by_usage_date["2025-11-19T01:00:00Z"]
    assert one_am_hour["requests"] == 2
    assert one_am_hour["totalTokens"] == 85
    assert one_am_hour["models"] == [
        {
            "estimatedCostUsd": 0.5,
            "model": "claude-sonnet-4",
            "requests": 2,
            "tokens": 85,
        }
    ]

    idle_hour = hourly_by_usage_date["2025-11-19T03:00:00Z"]
    assert idle_hour == {
        "usageDate": "2025-11-19T03:00:00Z",
        "requests": 0,
        "totalTokens": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "cachedTokens": 0,
        "reasoningTokens": 0,
        "estimatedCostUsd": 0.0,
        "models": [],
    }


def test_diagnose_config_reports_missing_ingest_settings(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    config = _config(db_path)
    config.endpoint = ""
    config.token = ""
    report = diagnose_config(config, require_ingest=True)

    assert report.ok is False
    assert report.db_exists is True
    assert report.db_readable is True
    assert report.session_count == 2
    assert report.sessions_in_window == 2
    assert any("HERMES_TOKEN_ANALYTICS_ENDPOINT" in item for item in report.issues)
    assert any("HERMES_TOKEN_ANALYTICS_TOKEN" in item for item in report.issues)


def test_render_config_snapshot_masks_secret(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    snapshot = render_config_snapshot(_config(db_path))
    assert snapshot["db_path"] == str(db_path)
    assert snapshot["token_configured"] is True
    assert snapshot["token"] == "secr**********alue"
    assert snapshot["source_label"] == "Hermes token analytics plugin"


def test_install_cron_wrapper_writes_executable_script(tmp_path):
    wrapper = install_cron_wrapper(tmp_path / "token_analytics_sync.sh", force=False)
    assert wrapper.exists()
    assert wrapper.read_text() == (
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n\n"
        "exec hermes token-analytics sync \"$@\"\n"
    )
    assert wrapper.stat().st_mode & 0o111


def test_post_payload_sends_cloudflare_friendly_headers(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_db(db_path)
    config = _config(db_path)
    payload = {"rollups": [{"usageDate": "2026-01-01", "requests": 1, "inputTokens": 1, "outputTokens": 1}]}

    seen: dict[str, str] = {}

    class _Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"ok": true}'

    def _fake_urlopen(request, timeout):
        seen["timeout"] = str(timeout)
        seen["authorization"] = request.get_header("Authorization")
        seen["content_type"] = request.get_header("Content-type")
        seen["user_agent"] = request.get_header("User-agent")
        seen["accept"] = request.get_header("Accept")
        return _Response()

    monkeypatch.setattr(_cli.urllib.request, "urlopen", _fake_urlopen)

    response = post_payload(config, payload)

    assert response == {"ok": True}
    assert seen["timeout"] == "1.0"
    assert seen["authorization"] == "Bearer secret-token-value"
    assert seen["content_type"] == "application/json"
    assert seen["user_agent"] == "hermes-token-analytics/1.0"
    assert seen["accept"] == "application/json"
