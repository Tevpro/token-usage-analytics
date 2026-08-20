CREATE TABLE repositories (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  repository_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, repository_key),
  UNIQUE (workspace_id, id)
);

CREATE INDEX repositories_workspace_idx ON repositories (workspace_id);

CREATE TABLE repository_daily_usage (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  repository_id TEXT,
  usage_date TEXT NOT NULL,
  environment TEXT NOT NULL,
  attribution_status TEXT NOT NULL CHECK (attribution_status IN ('exact', 'cwd-derived', 'unknown')),
  requests INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, repository_id) REFERENCES repositories(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX repository_daily_usage_workspace_date_repo_idx
  ON repository_daily_usage (workspace_id, usage_date, repository_id);

CREATE TABLE repository_model_daily_usage (
  id TEXT PRIMARY KEY NOT NULL,
  repository_rollup_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  requests INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  FOREIGN KEY (repository_rollup_id) REFERENCES repository_daily_usage(id) ON DELETE CASCADE
);

CREATE INDEX repository_model_daily_usage_rollup_idx
  ON repository_model_daily_usage (repository_rollup_id);
