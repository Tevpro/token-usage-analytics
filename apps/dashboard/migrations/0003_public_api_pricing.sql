ALTER TABLE model_daily_usage ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE daily_usage_rollups ADD COLUMN actual_cost_usd REAL;
ALTER TABLE daily_usage_rollups ADD COLUMN actual_cost_observed_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_usage_rollups ADD COLUMN actual_cost_observed_tokens INTEGER NOT NULL DEFAULT 0;

CREATE TABLE public_model_pricing_daily (
  effective_day TEXT NOT NULL,
  price_key TEXT NOT NULL,
  requested_provider TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  source_provider TEXT,
  source_model TEXT,
  input_micro_usd_per_mtok INTEGER NOT NULL DEFAULT 0,
  output_micro_usd_per_mtok INTEGER NOT NULL DEFAULT 0,
  cache_read_micro_usd_per_mtok INTEGER NOT NULL DEFAULT 0,
  cache_write_micro_usd_per_mtok INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  PRIMARY KEY (effective_day, price_key)
);

CREATE INDEX public_model_pricing_daily_fetched_at_idx
  ON public_model_pricing_daily (fetched_at);
