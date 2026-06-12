CREATE TABLE model_pricing_cache (
  match_key TEXT PRIMARY KEY NOT NULL,
  requested_model TEXT NOT NULL,
  source_model TEXT,
  source_provider TEXT,
  input_cost_per_token REAL,
  output_cost_per_token REAL,
  cache_read_input_cost_per_token REAL,
  resolved INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  source_url TEXT NOT NULL
);

CREATE INDEX model_pricing_cache_fetched_at_idx
  ON model_pricing_cache (fetched_at);
