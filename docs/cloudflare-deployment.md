# Cloudflare deployment

## TL;DR

The Cloudflare app now lives in `apps/dashboard/`.
All app, Wrangler, and D1 commands should be run from that directory.

## 1. Install dependencies

```bash
cd apps/dashboard
nub install --frozen-lockfile
```

## 2. Authenticate Wrangler

```bash
nubx wrangler login
nubx wrangler whoami
```

## 3. Verify the D1 binding

Check:

- `apps/dashboard/wrangler.jsonc`

Make sure the committed `d1_databases[0].database_id` is the right database for the environment you intend to deploy.

Dashboard reads are driven by the selected URL timeframe. The standard presets query
their matching D1 window, while `preset=custom&startDay=YYYY-MM-DD&endDay=YYYY-MM-DD`
queries that exact date range. `OPENAI_USAGE_DAYS_BACK` controls only the optional
OpenAI synchronization window; it does not limit dashboard reads.

Estimated cost is labeled **Estimated public API equivalent — effective daily rates**.
The dashboard stores an immutable snapshot for each exact effective day, provider, and model.
Only the current UTC usage day may be initialized from the live LiteLLM catalog. Plugin and
OpenAI ingestion capture missing snapshots for models observed that day. The separate
`token-usage-analytics-pricing-snapshot` Worker runs at 00:05 UTC and pre-captures rates for
known models, so pricing history no longer depends on somebody loading the dashboard. The
dashboard read remains a fail-open safety net. Missing historical snapshots remain unpriced
rather than borrowing a later rate. Input, output, cache-read, cache-write, and reasoning
dimensions remain separate. Unknown models and rows with incomplete dimensions also remain
unpriced.

Each snapshot retains the catalog source URL, resolved source model/provider, retrieval time,
and effective day. `INSERT ... ON CONFLICT DO NOTHING` preserves the first stored snapshot, so
a future catalog refresh cannot silently rewrite historical estimates. Correcting a historical
rate requires an explicit audited data change.

**Actual provider-reported cost** is stored and displayed independently. A nullable actual-cost
value distinguishes unavailable telemetry from an explicitly reported `$0.00`; token coverage
is recomputed after active date and project filters. Source estimates are not relabeled as actual
cost, and fixed subscription fees are not allocated to token rows.

Migration `0003_public_api_pricing.sql` must be applied before daily pricing and actual-cost
storage are enabled. It also adds separate input, output, cache-read, cache-write, and reasoning
dimensions to model rollups. Preview deployments must not apply this migration to the production
D1 database; an unmigrated preview degrades to unavailable pricing/actual-cost states while
tracked usage remains available.

## 4. Generate types

```bash
nub run cf:typegen
```

## 5. Apply migrations locally

```bash
nub run cf:d1:migrate:local
```

## 6. Apply migrations remotely

```bash
nub run cf:d1:migrate:remote
```

## 7. Run the app locally

```bash
nub run dev
```

## 8. Deploy manually

```bash
nub run deploy
```

This deploys both the dashboard Worker and the scheduled pricing-snapshot Worker. PR previews
deploy only the dashboard Worker and never create or mutate the production cron trigger.

## 9. GitHub Actions deployment

The repo includes path-aware GitHub Actions workflows.
Dashboard deploy flows only fire when dashboard/deploy paths change.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Deploy workflow behavior:

1. install dependencies in `apps/dashboard/`
2. build the app
3. apply remote D1 migrations
4. deploy the dashboard Worker
5. deploy the scheduled pricing-snapshot Worker

See `docs/github-actions.md` for the exact GitHub setup.
