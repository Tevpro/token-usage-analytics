# Hermes token analytics plugin operations

## TL;DR

This integration is now a **Hermes-native Python plugin**, not a Node or bash sidecar.

Operator setup is:

1. Set the Cloudflare Worker secret `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`.
2. Export the plugin env vars shown below.
3. Validate the install with:
   ```bash
   hermes token-analytics doctor
   hermes token-analytics show-config
   ```
4. Push one manual sync:
   ```bash
   hermes token-analytics sync
   ```
5. Let **Hermes cron own the schedule** by creating a single cron job that runs the sync command on a cadence such as every 15 minutes. That one job covers both rollups and heartbeat freshness.

If you just need the exact install sequence, use:

- `docs/hermes-token-analytics-install-runbook.md`

The split of responsibility is intentional:

- **Hermes cron** decides *when* the sync runs.
- **The token analytics plugin** decides *how* the sync reads `state.db`, builds rollups, and posts them to the Worker ingest endpoint.

## What this plugin is

The token analytics integration exports Hermes usage rollups from `~/.hermes/state.db` into this app's ingest endpoint:

- source database: Hermes `state.db`
- transport: authenticated HTTP `POST`
- destination: `POST /api/ingest/hermes-usage`
- dashboard storage: Cloudflare D1

This repo is the dashboard and ingest target. The operator-facing runtime is the Hermes plugin command surface, and the source-of-truth plugin files now live in this monorepo under `plugins/hermes-token-analytics/`:

- `hermes token-analytics doctor`
- `hermes token-analytics show-config`
- `hermes token-analytics sync`
- `hermes token-analytics install-cron-wrapper`

For local Hermes checkout installs, the helper now copies the plugin into `plugins/hermes-token-analytics/` and also writes a legacy compatibility shim at `plugins/observability/token_analytics/` so existing enabled-plugin configs do not break mid-upgrade.

## Architecture and ownership

### Hermes-native plugin, not a sidecar

Use the Hermes plugin command surface directly. Do **not** treat this as a separate Node service, shell wrapper, or long-running exporter process.

Why this matters:

- no extra service lifecycle to supervise
- config stays in Hermes-native env settings
- cron integrates cleanly with Hermes job management
- manual and scheduled runs use the same command path

### Scheduling model

Scheduling is **not** plugin config.

- Put cadence, pause/resume state, and one-off triggering under `hermes cron ...`
- Put endpoint, token, DB path, workspace labeling, and backfill depth under plugin env/config
- When the sync runs on a 15-minute cadence, the plugin still emits a heartbeat via `generatedAt` even if there were no requests, and the dashboard treats that as liveness while filling any missing hourly chart buckets in the UI

UI note: the dashboard may refer to these imported workspaces as **Agents** in user-facing filters and breakdowns. The plugin config keys remain workspace-based.

If a sync is running at the wrong time, fix Hermes cron.
If a sync is reading the wrong DB or posting to the wrong workspace, fix plugin config.

## Required Worker-side configuration

The Worker route rejects unauthenticated syncs.

Set this secret in the Worker runtime:

- `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`

The plugin and the Worker should use the same env var name, `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`. Legacy `INGEST_SHARED_SECRET` and `HERMES_TOKEN_ANALYTICS_TOKEN` are still accepted during migration.

The ingest endpoint in this repo is:

```text
POST /api/ingest/hermes-usage
```

A missing Worker secret returns `503`.
A bad or missing shared secret returns `401`.

## Plugin configuration

The plugin uses environment variables as the operator-facing source of truth.

### Configuration reference

| Variable | Required | Default | Example | What it controls |
| --- | --- | --- | --- | --- |
| `HERMES_TOKEN_ANALYTICS_DB_PATH` | No | `~/.hermes/state.db` | `/home/hermes/.hermes/state.db` | SQLite database path to read Hermes usage from. Override only if `state.db` lives elsewhere. |
| `HERMES_TOKEN_ANALYTICS_DB_TIMEOUT` | No | `30` seconds | `30` | SQLite and network-facing timeout budget for sync operations. Increase if the host or endpoint is slow. |
| `HERMES_TOKEN_ANALYTICS_ENDPOINT` | Yes | none | `https://token-usage-analytics.tevpro.workers.dev/api/ingest/hermes-usage` | Full HTTPS ingest URL for this dashboard. |
| `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` | Yes | none | `tok_live_xxx` | Bearer token sent to the Worker. Must match Worker `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`. |
| `HERMES_TOKEN_ANALYTICS_WORKSPACE_SLUG` | No | `hermes-usage` | `prod-hermes-usage` | Stable workspace identifier used by the dashboard and D1 rows. Keep this stable once data exists. In the current dashboard UI, this workspace is presented as an agent selection. |
| `HERMES_TOKEN_ANALYTICS_WORKSPACE_NAME` | No | `Hermes Usage` | `Tevpro Hermes Usage` | Human-readable workspace label shown in the dashboard. In the current UI this is the friendly agent name users see. |
| `HERMES_TOKEN_ANALYTICS_ENVIRONMENT` | No | `production` | `staging` | Environment label attached to imported rollups. |
| `HERMES_TOKEN_ANALYTICS_DAYS_BACK` | No | `30` | `14` | Backfill window for each sync. The plugin rereads this many days and republishes that range. |

### Recommended export block

```bash
export HERMES_TOKEN_ANALYTICS_DB_PATH="$HOME/.hermes/state.db"
export HERMES_TOKEN_ANALYTICS_DB_TIMEOUT="30"
export HERMES_TOKEN_ANALYTICS_ENDPOINT="https://token-usage-analytics.tevpro.workers.dev/api/ingest/hermes-usage"
export HERMES_TOKEN_ANALYTICS_SHARED_SECRET="replace-with-worker-ingest-secret"
export HERMES_TOKEN_ANALYTICS_WORKSPACE_SLUG="hermes-usage"
export HERMES_TOKEN_ANALYTICS_WORKSPACE_NAME="Hermes Usage"
export HERMES_TOKEN_ANALYTICS_ENVIRONMENT="production"
export HERMES_TOKEN_ANALYTICS_DAYS_BACK="30"
```

### Configuration notes

- `show-config` should display the **effective** config, with secrets redacted.
- Keep `WORKSPACE_SLUG` stable. Changing it creates or selects a different dashboard workspace/agent identity in the UI.
- `DAYS_BACK` controls how much history each run republishes. A larger number is useful for repair or backfill, but it increases sync work.
- `DB_TIMEOUT` should be treated as an operator knob, not a scheduler knob.

## CLI operations

### `hermes token-analytics doctor`

Use this first whenever setup changes.

Expected checks:

- plugin command is installed and callable
- `state.db` path resolves and is readable
- required env vars are present when a real sync is expected
- endpoint shape is valid
- recent session counts and date range look sane

Example:

```bash
hermes token-analytics doctor
```

Use it when:

- first-time setup
- shared secret rotation
- endpoint changes
- DB path changes
- cron jobs start failing

### `hermes token-analytics show-config`

Print the resolved runtime config before enabling cron.

Example:

```bash
hermes token-analytics show-config
```

Expected behavior:

- shows resolved DB path
- shows endpoint
- shows workspace slug/name/environment
- shows days-back and timeout values
- **redacts** `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`

Use it to catch:

- wrong shell profile exports
- typos in env var names
- stale workspace labels
- accidentally pointing at the wrong Worker URL

### `hermes token-analytics sync`

Run one foreground sync immediately.

Example:

```bash
hermes token-analytics sync
```

Use it for:

- first successful import
- post-deploy smoke test
- backfill validation
- confirming a cron fix

A successful run should:

1. open the configured `state.db`
2. aggregate the requested day range
3. `POST` the payload to the Worker endpoint
4. receive a successful response from the ingest route
5. make the imported workspace visible in the dashboard

### `hermes token-analytics install-cron-wrapper`

Install a thin shell wrapper for Hermes cron `no_agent` jobs.

Example:

```bash
hermes token-analytics install-cron-wrapper
```

Expected result:

- writes a script under `~/.hermes/scripts/`
- the script does one thing, `hermes token-analytics sync`
- Hermes cron can call that script directly without inventing its own terminal flow

Use `--force` if you intentionally want to replace the wrapper.

## Hermes cron operations

Hermes cron owns schedule timing. The plugin command stays the same whether it is run manually or on a schedule.

### Check scheduler status

```bash
hermes cron status
```

### Create a scheduled sync job

Cadence recommendation: every 15 minutes.

Why 15 minutes:

- current-day analytics stay reasonably fresh
- `state.db` reads stay cheap
- this remains periodic ingestion, not pretend real-time streaming

Recommended setup:

1. Install the wrapper once:
   ```bash
   hermes token-analytics install-cron-wrapper
   ```
2. Create a script-backed Hermes cron job:
   ```bash
   hermes cron create "every 15m" \
     --name "token-analytics-sync" \
     --script token_analytics_sync.sh \
     --no-agent
   ```

If you prefer a prompt-driven job instead of a wrapper, keep the prompt thin and still route execution through `hermes token-analytics sync`.

- schedule in Hermes cron
- sync behavior in `hermes token-analytics sync`

### Inspect jobs

```bash
hermes cron list --all
```

Use this to confirm:

- job ID
- schedule
- enabled vs paused state
- whether you accidentally created duplicate sync jobs

### Pause a job

```bash
hermes cron pause <job_id>
```

Pause before:

- endpoint maintenance
- shared secret rotation
- changing workspace routing
- large manual backfills

### Resume a job

```bash
hermes cron resume <job_id>
```

Resume only after `doctor` and a manual `sync` both succeed.

### Trigger a job once

```bash
hermes cron run <job_id>
```

Use this after editing config or resuming a paused job to confirm the scheduler path still works.

### Update an existing job

If the schedule or metadata is wrong, edit the cron job rather than changing plugin config:

```bash
hermes cron edit <job_id> --schedule "every 30m"
```

## Verification

Use this sequence before declaring the integration healthy.

### 1. Verify the DB path is readable

```bash
hermes token-analytics doctor
```

What you want:

- no missing-file error for `HERMES_TOKEN_ANALYTICS_DB_PATH`
- no permission error reading `state.db`

### 2. Verify the effective config

```bash
hermes token-analytics show-config
```

Confirm:

- endpoint is the expected Worker URL
- token is present but redacted
- workspace slug/name are correct
- environment label is correct
- days-back and timeout values match expectations

### 3. Verify one manual sync

```bash
hermes token-analytics sync
```

What you want:

- no auth error
- no network error
- no schema/read error from `state.db`
- success response from the Worker ingest route

### 4. Verify the Worker accepted the payload

The ingest route in this repo accepts authenticated `POST` requests and writes rollups into D1.

Practical checks:

- sync command exits successfully
- no `401 Unauthorized`
- no `503 HERMES_TOKEN_ANALYTICS_SHARED_SECRET is not configured`
- no `400` validation error from malformed payload data

### 5. Verify dashboard data moved

Open the dashboard and confirm:

- the target workspace exists
- the expected environment label is present
- recent dates in the selected `DAYS_BACK` window are populated
- the dashboard no longer relies on fallback/sample data for that workspace

### 6. Verify scheduled execution

After enabling cron:

```bash
hermes cron list --all
hermes cron run <job_id>
```

Confirm the cron-triggered run behaves the same as the manual sync path.

## Failure modes and remediation

### Missing or bad `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`

Symptoms:

- `doctor` flags auth/config problems
- `sync` fails with `401 Unauthorized`

Fix:

- confirm `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` is set
- confirm it exactly matches Worker `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
- rerun `doctor`, then `sync`

### Bad `HERMES_TOKEN_ANALYTICS_ENDPOINT`

Symptoms:

- DNS or connection errors
- `404` or unexpected HTTP errors

Fix:

- confirm the full ingest URL, including `/api/ingest/hermes-usage`
- confirm you are pointing at the intended preview or production Worker
- rerun `show-config` to verify the resolved endpoint

### Wrong `HERMES_TOKEN_ANALYTICS_DB_PATH`

Symptoms:

- missing file error
- permissions error
- empty or obviously wrong usage results

Fix:

- point `HERMES_TOKEN_ANALYTICS_DB_PATH` at the real Hermes `state.db`
- verify the user running Hermes cron can read it
- rerun `doctor`

### `state.db` schema drift

Symptoms:

- plugin read/query failures during `doctor` or `sync`
- successful auth but failed rollup generation

Fix:

- upgrade the plugin to the schema-aware version expected by your Hermes install
- verify the Hermes local database schema has not changed unexpectedly
- rerun a manual `sync` before re-enabling cron

### Worker secret not configured

Symptoms:

- `sync` fails with `503`
- response includes `HERMES_TOKEN_ANALYTICS_SHARED_SECRET is not configured in the Worker runtime`

Fix:

- set the Worker runtime secret
- redeploy if required by your Worker workflow
- retry manual sync

### Backfill or duplicate-data expectations

This ingest flow republishes a day range; it is not append-only stream processing.

Operationally that means:

- `HERMES_TOKEN_ANALYTICS_DAYS_BACK` defines the rewritten window each run
- a larger backfill window is normal after outages or repairs
- changing `WORKSPACE_SLUG` creates a different workspace instead of updating the existing one

If numbers look duplicated or split unexpectedly, first check:

- workspace slug stability
- environment label consistency
- whether multiple cron jobs are posting the same source to different workspace labels

### Cron is healthy but imports are stale

Symptoms:

- scheduler running
- job exists and is enabled
- dashboard data is still old

Fix:

- manually run `hermes token-analytics doctor`
- manually run `hermes token-analytics sync`
- inspect whether cron is targeting the intended Hermes profile and environment exports
- verify the cron job was not duplicated, paused, or edited to run the wrong task

## Migration note from the sidecar-era docs

Older docs in this repo described a Python exporter plus shell wrapper sidecar flow. Treat that as **stale**.

Canonical operator guidance is now this plugin document.

If you still have old env files or wrappers, map them conceptually like this:

- old sidecar endpoint/token settings -> plugin `HERMES_TOKEN_ANALYTICS_ENDPOINT` and `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
- old shell scheduling -> `hermes cron ...`
- old direct Python export invocation -> `hermes token-analytics sync`

### Shared-secret variable migration

Older installs may still use:

- Worker: `INGEST_SHARED_SECRET`
- Hermes plugin: `HERMES_TOKEN_ANALYTICS_TOKEN`

Move both sides to:

- `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`

Recommended migration sequence:

1. Add `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` to the Worker with the same secret value.
2. Add `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` to the Hermes profile `.env` with the same value.
3. Run `hermes token-analytics doctor` and `hermes token-analytics sync`.
4. Once verified, delete `INGEST_SHARED_SECRET` and `HERMES_TOKEN_ANALYTICS_TOKEN`.

This release keeps the old names as fallbacks so the migration can be done safely, but the new name should be treated as the canonical interface in docs, automation, and future installs.

The important migration outcome is simple: keep ingestion Hermes-native and keep scheduling under Hermes cron.
