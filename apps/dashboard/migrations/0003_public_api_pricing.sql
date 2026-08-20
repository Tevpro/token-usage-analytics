ALTER TABLE model_daily_usage ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_daily_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;

CREATE TABLE public_model_pricing_cache (
  price_key TEXT PRIMARY KEY NOT NULL,
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
  source_url TEXT NOT NULL
);

CREATE INDEX public_model_pricing_cache_fetched_at_idx
  ON public_model_pricing_cache (fetched_at);
