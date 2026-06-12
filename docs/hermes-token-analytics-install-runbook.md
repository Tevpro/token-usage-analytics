# Hermes token analytics install runbook

## TL;DR

Use this when you need to install the Hermes token analytics plugin into a Hermes checkout and make the dashboard stay fresh.

The key operational rule is simple:

Use the same secret env var name on both sides: `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`.

- install and enable the plugin once
- configure the Worker secret and plugin env vars
- validate with `doctor`, `show-config`, and one manual `sync`
- create **one** Hermes cron sync job

That single sync job handles both concerns:

- it publishes rollups when usage exists
- it still emits a heartbeat via `generatedAt` when there were no recent requests

Do **not** create separate heartbeat and rollup cron jobs unless the product design changes.

## Scope

This repo owns:

- the dashboard app in `apps/dashboard/`
- the ingest contract at `POST /api/ingest/hermes-usage`
- the Hermes plugin source in `plugins/hermes-token-analytics/`
- the operator docs in `docs/`

This runbook is written for agents and operators who need a repeatable install path with exact commands.

## Prerequisites

Before you start, confirm:

1. you have a Hermes checkout available, usually `~/.hermes/hermes-agent`
2. you know which Hermes profile will run the cron job
3. the Cloudflare Worker has `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` configured
4. you have the matching shared secret value for `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
5. the target host can read the Hermes `state.db`

## Step 1. Install the plugin into the Hermes checkout

From this repo root, copy the plugin into the target Hermes checkout:

```bash
plugins/hermes-token-analytics/scripts/install-local-plugin.sh /path/to/hermes-agent
```

If you omit the argument, the helper defaults to:

```bash
plugins/hermes-token-analytics/scripts/install-local-plugin.sh
```

which installs into:

```text
~/.hermes/hermes-agent
```

What the helper does:

- copies the plugin to `plugins/hermes-token-analytics/` inside the target Hermes checkout
- writes a compatibility shim at `plugins/observability/token_analytics/`
- lets older `plugins.enabled` entries keep working during migration

## Step 2. Enable the plugin in Hermes

Enable the plugin by its path-derived key:

```bash
hermes plugins enable hermes-token-analytics
```

Then verify Hermes sees it:

```bash
hermes plugins list
```

What you want to see:

- `hermes-token-analytics` listed as enabled

If the target install still references the old compatibility path, the shim also supports the legacy key:

```text
observability/token_analytics
```

Use the real plugin key for new installs.

## Step 3. Configure the Worker secret and plugin env vars

Worker side:

- set `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` in the Cloudflare Worker runtime
- legacy `INGEST_SHARED_SECRET` still works, but only as a fallback during migration

Hermes side:

- put the plugin settings in the env file for the Hermes profile that will run the job
- `hermes config env-path` tells you which `.env` file the active profile uses

Recommended env block:

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

Operational notes:

- `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` must exactly match Worker `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
- keep `HERMES_TOKEN_ANALYTICS_WORKSPACE_SLUG` stable after go-live
- `HERMES_TOKEN_ANALYTICS_DAYS_BACK` controls how much history each sync republishes
- if the dashboard UI says **Agent**, that is still this same workspace identity underneath

### Migration from the old shared-secret names

If you are upgrading from an older release, migrate both sides to `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`.

1. In the Cloudflare Worker runtime, add `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` with the same value currently used for `INGEST_SHARED_SECRET`.
2. In the Hermes profile `.env`, replace `HERMES_TOKEN_ANALYTICS_TOKEN=...` with `HERMES_TOKEN_ANALYTICS_SHARED_SECRET=...`.
3. Run `hermes token-analytics doctor` and `hermes token-analytics show-config` to confirm the new name is being read.
4. After validation, remove the legacy names from both environments so future operators only see one convention.

Temporary compatibility rules in this release:

- Worker side: `INGEST_SHARED_SECRET` is still accepted as a fallback.
- Hermes side: `HERMES_TOKEN_ANALYTICS_TOKEN` is still accepted as a fallback.
- Preferred steady state: only `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` remains.

## Step 4. Validate the install before scheduling anything

Run these checks in order:

```bash
hermes token-analytics doctor
hermes token-analytics show-config
hermes token-analytics sync
```

What success looks like:

- `doctor` confirms the plugin command is callable and `state.db` is readable
- `show-config` shows the resolved endpoint, workspace fields, and redacted shared secret
- `sync` posts successfully to `/api/ingest/hermes-usage`

If `sync` fails, stop here and fix config before adding cron.

## Step 5. Create the scheduled job

Install the cron wrapper once:

```bash
hermes token-analytics install-cron-wrapper
```

Then create the recurring sync job:

```bash
hermes cron create "every 15m" \
  --name "token-analytics-sync" \
  --script token_analytics_sync.sh \
  --no-agent
```

Why this is the right job model:

- one job keeps current-day rollups fresh
- the same job provides heartbeat freshness through `generatedAt`
- one job avoids skew where a heartbeat says "alive" but rollups are stale

### Heartbeat and rollup rule

For this plugin, **heartbeat is a property of sync**, not a separate workflow.

That means:

- if there are recent Hermes requests, the sync sends rollups and a fresh `generatedAt`
- if there were no recent Hermes requests, the sync can still send a heartbeat-only payload
- the dashboard uses that heartbeat to show the agent/workspace as fresh instead of dead

Unless the ingest contract changes, the correct setup is:

- **1 plugin install**
- **1 config block**
- **1 cron sync job**

Not two jobs.

## Step 6. Verify the scheduled path

After the cron job exists:

```bash
hermes cron list --all
hermes cron run <job_id>
```

Confirm:

- the job is enabled
- the schedule is correct
- the cron-triggered run behaves the same as the manual `sync`

## Normal operating procedure

Use this sequence for changes or repairs:

1. pause the cron job if you are rotating tokens or changing routing
2. update env/config
3. rerun `doctor`
4. rerun `show-config`
5. rerun one manual `sync`
6. resume the cron job
7. optionally `hermes cron run <job_id>` once to verify the scheduler path

## Common failure modes

### `401 Unauthorized`

Usually means:

- missing `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
- shared secret does not match `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`

### `503 HERMES_TOKEN_ANALYTICS_SHARED_SECRET is not configured`

Usually means:

- Worker secret is missing in the deployed runtime

### Plugin command not found

Usually means:

- plugin files were not copied into the Hermes checkout
- plugin was not enabled with `hermes plugins enable hermes-token-analytics`

### Cron is running but dashboard freshness is stale

Check, in order:

1. `hermes token-analytics doctor`
2. `hermes token-analytics show-config`
3. `hermes token-analytics sync`
4. `hermes cron list --all`
5. whether someone created duplicate or conflicting jobs

## Quick command block

If you just want the minimal procedure:

```bash
# from this repo root
plugins/hermes-token-analytics/scripts/install-local-plugin.sh
hermes plugins enable hermes-token-analytics

# configure env for the right Hermes profile, then validate
hermes token-analytics doctor
hermes token-analytics show-config
hermes token-analytics sync

# install one recurring sync job that covers both rollups and heartbeat
hermes token-analytics install-cron-wrapper
hermes cron create "every 15m" \
  --name "token-analytics-sync" \
  --script token_analytics_sync.sh \
  --no-agent
```
