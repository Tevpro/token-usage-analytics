CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE daily_usage_rollups (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  environment TEXT NOT NULL,
  requests INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL,
  p95_latency_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX daily_usage_rollups_workspace_date_idx
  ON daily_usage_rollups (workspace_id, usage_date);
CREATE INDEX daily_usage_rollups_environment_idx
  ON daily_usage_rollups (environment);

CREATE TABLE model_daily_usage (
  id TEXT PRIMARY KEY NOT NULL,
  rollup_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  requests INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  FOREIGN KEY (rollup_id) REFERENCES daily_usage_rollups(id) ON DELETE CASCADE
);

CREATE INDEX model_daily_usage_rollup_idx ON model_daily_usage (rollup_id);

CREATE TABLE tool_daily_usage (
  id TEXT PRIMARY KEY NOT NULL,
  rollup_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (rollup_id) REFERENCES daily_usage_rollups(id) ON DELETE CASCADE
);

CREATE INDEX tool_daily_usage_rollup_idx ON tool_daily_usage (rollup_id);

CREATE TABLE issue_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  usage_date TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title TEXT NOT NULL,
  count INTEGER NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX issue_events_workspace_date_idx ON issue_events (workspace_id, usage_date);
CREATE INDEX issue_events_severity_idx ON issue_events (severity);
