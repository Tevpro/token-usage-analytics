from __future__ import annotations

import importlib.util
import sqlite3
import subprocess
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


def _make_empty_db(path: Path) -> None:
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
    conn.commit()
    conn.close()


def _config(db_path: Path) -> TokenAnalyticsConfig:
    return TokenAnalyticsConfig(
        db_path=db_path,
        db_timeout=1.0,
        endpoint="https://analytics.example.com/api/ingest/hermes-usage",
        shared_secret="secret-token-value",
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
    assert day["usageDate"] == "2025-11-19"
    assert day["requests"] == 5
    assert day["inputTokens"] == 150
    assert day["outputTokens"] == 70
    assert day["cachedTokens"] == 35
    assert day["reasoningTokens"] == 5
    assert day["totalTokens"] == 260
    assert day["estimatedCostUsd"] == 2.0
    assert day["actualCostUsd"] == 0.5
    assert day["actualCostObservedSessions"] == 1
    assert day["actualCostObservedTokens"] == 85
    assert [model["model"] for model in day["models"]] == ["gpt-5.4", "claude-sonnet-4"]
    assert day["models"][0]["tokens"] == 175
    assert day["models"][0] == {
        "cacheReadTokens": 20,
        "cacheWriteTokens": 10,
        "actualCostObservedSessions": 0,
        "actualCostObservedTokens": 0,
        "actualCostUsd": None,
        "estimatedCostUsd": 1.25,
        "inputTokens": 100,
        "model": "gpt-5.4",
        "outputTokens": 40,
        "provider": "OpenAI",
        "reasoningTokens": 5,
        "requests": 3,
        "tokens": 175,
    }
    assert day["models"][1]["provider"] == "Anthropic"
    assert day["models"][1]["cacheReadTokens"] == 0
    assert day["models"][1]["cacheWriteTokens"] == 5
    assert day["models"][1]["estimatedCostUsd"] == 0.75
    assert day["models"][1]["actualCostUsd"] == 0.5
    assert day["models"][1]["actualCostObservedSessions"] == 1
    assert day["models"][1]["actualCostObservedTokens"] == 85


def test_build_payload_omits_idle_hourly_rollups_and_only_sends_real_usage_hours(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    fixed_now = _cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)

    payload = build_payload(_config(db_path))

    hourly_rollups = [row for row in payload["rollups"] if "T" in row["usageDate"]]
    assert len(hourly_rollups) == 2

    hourly_by_usage_date = {row["usageDate"]: row for row in hourly_rollups}

    midnight_hour = hourly_by_usage_date["2025-11-19T00:00:00Z"]
    assert midnight_hour["requests"] == 3
    assert midnight_hour["totalTokens"] == 175
    assert midnight_hour["models"] == [
        {
            "actualCostObservedSessions": 0,
            "actualCostObservedTokens": 0,
            "actualCostUsd": None,
            "cacheReadTokens": 20,
            "cacheWriteTokens": 10,
            "estimatedCostUsd": 1.25,
            "inputTokens": 100,
            "model": "gpt-5.4",
            "outputTokens": 40,
            "provider": "OpenAI",
            "reasoningTokens": 5,
            "requests": 3,
            "tokens": 175,
        }
    ]

    one_am_hour = hourly_by_usage_date["2025-11-19T01:00:00Z"]
    assert one_am_hour["requests"] == 2
    assert one_am_hour["totalTokens"] == 85
    assert one_am_hour["models"] == [
        {
            "actualCostObservedSessions": 1,
            "actualCostObservedTokens": 85,
            "actualCostUsd": 0.5,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 5,
            "estimatedCostUsd": 0.75,
            "inputTokens": 50,
            "model": "claude-sonnet-4",
            "outputTokens": 30,
            "provider": "Anthropic",
            "reasoningTokens": 0,
            "requests": 2,
            "tokens": 85,
        }
    ]

    assert "2025-11-19T03:00:00Z" not in hourly_by_usage_date


def test_build_payload_can_send_heartbeat_only_when_no_rollups_exist(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_empty_db(db_path)

    fixed_now = _cli.datetime(2026, 5, 23, 12, 0, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)
    monkeypatch.setattr(_cli, "_iso_now", lambda: fixed_now.isoformat().replace("+00:00", "Z"))

    payload = build_payload(_config(db_path))

    assert payload["generatedAt"] == "2026-05-23T12:00:00Z"
    assert payload["rollups"] == []


def test_diagnose_config_reports_missing_ingest_settings(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    config = _config(db_path)
    config.endpoint = ""
    config.shared_secret = ""
    report = diagnose_config(config, require_ingest=True)

    assert report.ok is False
    assert report.db_exists is True
    assert report.db_readable is True
    assert report.session_count == 2
    assert report.sessions_in_window == 2
    assert any("HERMES_TOKEN_ANALYTICS_ENDPOINT" in item for item in report.issues)
    assert any("HERMES_TOKEN_ANALYTICS_SHARED_SECRET" in item for item in report.issues)


def test_render_config_snapshot_masks_secret(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    snapshot = render_config_snapshot(_config(db_path))
    assert snapshot["db_path"] == str(db_path)
    assert snapshot["shared_secret_configured"] is True
    assert snapshot["shared_secret"] == "secr**********alue"
    assert snapshot["source_label"] == "Hermes token analytics plugin"


def test_shared_secret_env_prefers_new_name_and_falls_back_to_legacy(monkeypatch):
    monkeypatch.delenv("HERMES_TOKEN_ANALYTICS_SHARED_SECRET", raising=False)
    monkeypatch.setenv("HERMES_TOKEN_ANALYTICS_TOKEN", "legacy-secret")
    assert _cli._shared_secret_from_env() == "legacy-secret"

    monkeypatch.setenv("HERMES_TOKEN_ANALYTICS_SHARED_SECRET", "new-secret")
    assert _cli._shared_secret_from_env() == "new-secret"


def test_install_cron_wrapper_writes_executable_script(tmp_path):
    wrapper = install_cron_wrapper(tmp_path / "token_analytics_sync.sh", force=False)
    assert wrapper.exists()
    assert wrapper.read_text() == (
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n\n"
        "exec hermes token-analytics sync \"$@\"\n"
    )
    assert wrapper.stat().st_mode & 0o111


def test_install_cron_wrapper_command_does_not_recommend_duplicate_job_creation(tmp_path, capsys):
    result = _cli._cmd_install_cron_wrapper(
        tmp_path / "token_analytics_sync.sh",
        force=False,
    )
    output = capsys.readouterr().out

    assert result == 0
    assert "hermes cron list --all" in output
    assert "REQUIRED_INSTALLATION_CHECKLIST.md" in output
    assert "hermes cron create" not in output


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


def test_build_payload_uses_utc_hour_for_hourly_rollups(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    class _FixedDateTime:
        @staticmethod
        def now(tz=None):
            from datetime import datetime, timezone
            current = datetime(2025, 11, 19, 2, 0, 0, tzinfo=timezone.utc)
            return current if tz is None else current.astimezone(tz)

        @staticmethod
        def fromtimestamp(value, tz=None):
            from datetime import datetime
            return datetime.fromtimestamp(value, tz=tz)

        @staticmethod
        def combine(date_value, time_value, tzinfo=None):
            from datetime import datetime
            return datetime.combine(date_value, time_value, tzinfo=tzinfo)

    monkeypatch.setattr(_cli, "datetime", _FixedDateTime)

    payload = build_payload(_config(db_path))
    hourly = [rollup for rollup in payload["rollups"] if "T" in rollup["usageDate"]]

    assert [rollup["usageDate"] for rollup in hourly] == [
        "2025-11-19T00:00:00Z",
        "2025-11-19T01:00:00Z",
    ]
    assert [rollup["requests"] for rollup in hourly] == [3, 2]


def test_build_payload_uses_utc_day_boundaries(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    conn = sqlite3.connect(db_path)
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
    conn.execute(
        """
        INSERT INTO sessions (
            id, source, model, started_at, ended_at, api_call_count,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, estimated_cost_usd, actual_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "s1",
            "slack",
            "gpt-5.4",
            1763511300.0,
            1763512200.0,
            1,
            10,
            5,
            0,
            0,
            0,
            0.25,
            None,
        ),
    )
    conn.commit()
    conn.close()

    class _FixedDateTime:
        @staticmethod
        def now(tz=None):
            from datetime import datetime, timezone
            current = datetime(2025, 11, 19, 12, 0, 0, tzinfo=timezone.utc)
            return current if tz is None else current.astimezone(tz)

        @staticmethod
        def fromtimestamp(value, tz=None):
            from datetime import datetime
            return datetime.fromtimestamp(value, tz=tz)

        @staticmethod
        def combine(date_value, time_value, tzinfo=None):
            from datetime import datetime
            return datetime.combine(date_value, time_value, tzinfo=tzinfo)

    monkeypatch.setattr(_cli, "datetime", _FixedDateTime)

    payload = build_payload(_config(db_path))

    assert payload["rollups"][0]["usageDate"] == "2025-11-19"


def test_build_payload_publishes_privacy_safe_reconciled_repository_rollups(tmp_path, monkeypatch):
    repo = tmp_path / "source" / "atlas"
    repo.mkdir(parents=True)
    (repo / "nested").mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "remote", "add", "origin", "https://user:secret@github.com/Tevpro/atlas.git"],
        check=True,
    )
    db_path = tmp_path / "state.db"
    _make_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("ALTER TABLE sessions ADD COLUMN cwd TEXT")
    conn.execute("ALTER TABLE sessions ADD COLUMN git_repo_root TEXT")
    conn.execute("UPDATE sessions SET git_repo_root = ? WHERE id = 's1'", (str(repo),))
    conn.execute("UPDATE sessions SET cwd = ? WHERE id = 's2'", (str(repo / 'nested'),))
    conn.commit()
    conn.close()

    fixed_now = _cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)
    payload = build_payload(_config(db_path))

    assert payload["schemaVersion"] == 2
    daily = [row for row in payload["repositoryRollups"] if "T" not in row["usageDate"]]
    assert {row["attributionStatus"] for row in daily} == {"exact", "cwd-derived"}
    assert {row["repository"]["key"] for row in daily} == {"github.com/Tevpro/atlas"}
    assert {row["repository"]["name"] for row in daily} == {"atlas"}
    assert all(str(tmp_path) not in str(row) and "secret" not in str(row) for row in daily)
    aggregate = next(row for row in payload["rollups"] if row["usageDate"] == "2025-11-19")
    assert sum(row["totalTokens"] for row in daily) == aggregate["totalTokens"]
    assert sum(row["requests"] for row in daily) == aggregate["requests"]
    assert sum(model["tokens"] for row in daily for model in row["models"]) == aggregate["totalTokens"]


def test_remote_identity_preserves_non_default_ports_and_handles_ipv6_scp():
    sanitize = _cli._sanitize_remote_identity

    assert sanitize('https://git.example.com:8443/org/repo.git') == 'git.example.com:8443/org/repo'
    assert sanitize('https://git.example.com:9443/org/repo.git') == 'git.example.com:9443/org/repo'
    assert sanitize('https://git.example.com:443/org/repo.git') == 'git.example.com/org/repo'
    assert sanitize('http://git.example.com:80/org/repo.git') == 'git.example.com/org/repo'
    assert sanitize('ssh://git@[2001:db8::1]:2222/org/repo.git') == '[2001:db8::1]:2222/org/repo'
    assert sanitize('git@[2001:db8::1]:org/repo.git') == '[2001:db8::1]/org/repo'
    assert sanitize('git@git.example.com:org/repo.git') == 'git.example.com/org/repo'


def test_build_payload_marks_legacy_schema_sessions_unattributed_without_failing(tmp_path):
    db_path = tmp_path / "state.db"
    _make_db(db_path)

    payload = build_payload(_config(db_path))

    daily = [row for row in payload["repositoryRollups"] if "T" not in row["usageDate"]]
    assert len(daily) == 1
    assert daily[0]["repository"] == {"key": "unattributed", "name": "Unattributed"}
    assert daily[0]["attributionStatus"] == "unknown"
    assert daily[0]["totalTokens"] == payload["rollups"][0]["totalTokens"]


def test_build_payload_uses_one_immutable_fetch_during_concurrent_write(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_db(db_path)
    fixed_now = _cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)

    original_fetch = _cli._fetch_session_metrics
    fetch_count = 0

    def fetch_then_write(connection, *, since=None):
        nonlocal fetch_count
        fetch_count += 1
        rows = original_fetch(connection, since=since)
        if fetch_count == 1:
            writer = sqlite3.connect(db_path)
            writer.execute(
                """
                INSERT INTO sessions (
                    id, source, model, started_at, ended_at, api_call_count,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    reasoning_tokens, estimated_cost_usd, actual_cost_usd
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("concurrent", "cli", "new-model", 1763517600.0, 1763517600.0,
                 100, 1000, 0, 0, 0, 0, 10.0, None),
            )
            writer.commit()
            writer.close()
        return rows

    monkeypatch.setattr(_cli, "_fetch_session_metrics", fetch_then_write)
    payload = build_payload(_config(db_path))

    assert fetch_count == 1
    daily = next(row for row in payload["rollups"] if row["usageDate"] == "2025-11-19")
    repositories = [row for row in payload["repositoryRollups"] if row["usageDate"] == "2025-11-19"]
    assert daily["requests"] == 5
    assert sum(row["requests"] for row in repositories) == daily["requests"]
    assert sum(model["requests"] for model in daily["models"]) == daily["requests"]


def test_cost_rounding_reconciles_aggregate_repositories_and_models(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    _make_empty_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("ALTER TABLE sessions ADD COLUMN cwd TEXT")
    conn.execute("ALTER TABLE sessions ADD COLUMN git_repo_root TEXT")
    conn.executemany(
        """
        INSERT INTO sessions (
            id, source, model, started_at, ended_at, api_call_count,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, estimated_cost_usd, actual_cost_usd, cwd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("a", "cli", "model-a", 1763510400.0, 1763510400.0, 1, 1, 0, 0, 0, 0, 0.00006, None, "repo-a"),
            ("b", "cli", "model-b", 1763510400.0, 1763510400.0, 1, 1, 0, 0, 0, 0, 0.00006, None, "repo-b"),
        ],
    )
    conn.commit()
    conn.close()

    fixed_now = _cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc)
    monkeypatch.setattr(_cli, "_utc_now", lambda: fixed_now)
    monkeypatch.setattr(
        _cli,
        "_resolve_session_repository",
        lambda row: ({"key": f"example.com/org/{row['cwd']}", "name": row["cwd"]}, "exact"),
    )

    payload = build_payload(_config(db_path))
    aggregate = next(row for row in payload["rollups"] if row["usageDate"] == "2025-11-19")
    repositories = [row for row in payload["repositoryRollups"] if row["usageDate"] == "2025-11-19"]

    assert aggregate["estimatedCostUsd"] == 0.0001
    assert abs(sum(model["estimatedCostUsd"] for model in aggregate["models"]) - aggregate["estimatedCostUsd"]) <= 1e-6
    assert abs(sum(row["estimatedCostUsd"] for row in repositories) - aggregate["estimatedCostUsd"]) <= 1e-6
    for row in repositories:
        assert abs(sum(model["estimatedCostUsd"] for model in row["models"]) - row["estimatedCostUsd"]) <= 1e-6


def test_repository_discovery_timeout_marks_session_unattributed(monkeypatch):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="git rev-parse", timeout=5)

    monkeypatch.setattr(_cli, "_git_output", timeout)

    assert _cli._git_repository_identity(Path(".")) is None


def test_remote_lookup_timeout_falls_back_to_local_repository_identity(monkeypatch, tmp_path):
    common_dir = tmp_path / ".git"
    common_dir.mkdir()

    def git_output(path, *args):
        if args[:2] == ("remote", "get-url"):
            raise subprocess.TimeoutExpired(cmd="git remote get-url origin", timeout=5)
        if args[-1] == "--show-toplevel":
            return str(tmp_path)
        return str(common_dir)

    monkeypatch.setattr(_cli, "_git_output", git_output)

    identity = _cli._git_repository_identity(tmp_path)
    assert identity is not None
    assert identity["key"].startswith("local:")
    assert identity["name"] == tmp_path.name


def test_scp_remote_identity_never_includes_query_or_fragment_credentials():
    sanitize = _cli._sanitize_remote_identity

    assert sanitize("git@git.example.com:org/repo.git?access_token=secret") == "git.example.com/org/repo"
    assert sanitize("git@git.example.com:org/repo.git#oauth-secret") == "git.example.com/org/repo"
    assert sanitize("git@git.example.com:org/repo.git?token=secret#fragment") == "git.example.com/org/repo"


def test_repository_rollups_cache_git_resolution_per_unique_path_before_bucket_expansion(tmp_path, monkeypatch):
    repository = tmp_path / "repository"
    unattributed = tmp_path / "not-a-repository"
    repository.mkdir()
    unattributed.mkdir()
    calls: list[tuple[Path, tuple[str, ...]]] = []

    def git_output(path, *args):
        calls.append((path, args))
        if path == unattributed:
            raise subprocess.CalledProcessError(128, ["git", "rev-parse"])
        if args[-1] == "--show-toplevel":
            return str(repository)
        if args[-1] == "--git-common-dir":
            return str(repository / ".git")
        return "https://github.com/Tevpro/repository.git"

    monkeypatch.setattr(_cli, "_git_output", git_output)
    session_ts = _cli.datetime(2025, 11, 19, 3, 0, tzinfo=_cli.timezone.utc).timestamp()

    def row(path, model):
        return {
            "session_ts": session_ts,
            "model": model,
            "api_calls": 1,
            "input_tokens": 1,
            "output_tokens": 0,
            "cached_tokens": 0,
            "reasoning_tokens": 0,
            "cost_usd": 0,
            "git_repo_root": str(path),
            "cwd": None,
        }

    rollups = _cli._build_repository_rollups(
        [
            row(repository, "model-a"),
            row(repository, "model-b"),
            row(unattributed, "model-a"),
            row(unattributed, "model-b"),
        ],
        days_back=7,
        now=_cli.datetime(2025, 11, 19, 3, 15, tzinfo=_cli.timezone.utc),
    )

    assert len([item for item in rollups if item["usageDate"] == "2025-11-19"]) == 2
    assert len([item for item in rollups if item["usageDate"] == "2025-11-19T03:00:00Z"]) == 2
    assert [path for path, _ in calls].count(repository) == 3
    assert [path for path, _ in calls].count(unattributed) == 1


def test_install_helper_carries_and_announces_required_production_checklist():
    plugin_dir = Path(__file__).resolve().parents[1]
    script = (plugin_dir / "scripts" / "install-local-plugin.sh").read_text()
    checklist = (plugin_dir / "REQUIRED_INSTALLATION_CHECKLIST.md").read_text()
    agent_instructions = (plugin_dir / "AGENTS.md").read_text()

    assert 'REQUIRED_INSTALLATION_CHECKLIST.md' in script
    assert 'AGENTS.md' in script
    assert 'INSTALLATION IS NOT COMPLETE' in script
    assert 'token-analytics-sync' in script
    assert 'cron-triggered run' in script
    assert 'hermes cron edit <job_id>' in checklist
    assert 'hermes cron remove <duplicate_job_id>' in checklist
    assert 'Installation status: COMPLETE | PARTIAL/BLOCKED' in checklist
    assert 'REQUIRED_INSTALLATION_CHECKLIST.md' in agent_instructions
