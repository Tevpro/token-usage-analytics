# REQUIRED: Hermes token analytics complete installation checklist

> [!IMPORTANT]
> **Agents and operators must follow this checklist from start to finish for every production install or upgrade.**
> Copying the plugin, enabling it, passing `doctor`, and completing one manual sync do **not** constitute a complete installation. The installation is production-ready only after the recurring cron job exists and a cron-triggered run has been verified.

## Agent execution contract

When a user asks to **install**, **set up**, **onboard**, or **upgrade** `hermes-token-analytics`, default to the complete production workflow in this document. Do not reinterpret “install” as “copy files and prove a manual sync.”

You may stop short only when:

- the user explicitly requests a manual-only/non-production install; or
- a required action is blocked by permissions or process boundaries.

If blocked, complete every independent step that remains possible, then report the exact blocker and command the user must run. Do not describe the installation as complete. A gateway restart blocked from inside the gateway does not make cron creation optional.

## Definition of done

A production installation is complete only when all of these are true:

1. the intended plugin version is copied to the correct plugin root;
2. the plugin is enabled;
3. the gateway has reloaded the plugin;
4. `doctor`, `show-config`, and a manual `sync` succeed;
5. `token_analytics_sync.sh` exists;
6. exactly one enabled `token-analytics-sync` cron job exists on the intended profile and cadence;
7. a cron-triggered run succeeds; and
8. dashboard freshness or the ingest response confirms the scheduled path reached the destination.

## TL;DR

Use this checklist when you need to install the Hermes token analytics plugin and keep the dashboard fresh without a second round of agent steering.

The key operational rule is simple:

Use the same secret env var name on both sides: `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`.

- install and enable the plugin once
- configure the Worker secret and plugin env vars
- validate with `doctor`, `show-config`, and one manual `sync`
- create and verify **one** Hermes cron sync job

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

This required checklist is written for agents and operators who need a repeatable install path with exact commands and an unambiguous definition of done.

## Prerequisites

Before you start, confirm:

1. you have a Hermes checkout available, usually `~/.hermes/hermes-agent`
2. you know which Hermes profile will run the cron job
3. the Cloudflare Worker has `HERMES_TOKEN_ANALYTICS_SHARED_SECRET` configured
4. you have the matching shared secret value for `HERMES_TOKEN_ANALYTICS_SHARED_SECRET`
5. the target host can read the Hermes `state.db`

## Step 1. Install the plugin into the Hermes checkout

> [!WARNING]
> This repository is a monorepo. The Hermes plugin is **not** at the repo root.
> Do **not** install the repo root directly with `hermes plugins install <repo-url>`.
> The actual plugin source lives at `plugins/hermes-token-analytics/`.

### Install target options

There are two valid install targets. They are not the same thing.

1. **Bundled checkout plugin path**, for development inside a Hermes repo checkout
   - target root: `~/.hermes/hermes-agent`
   - resulting plugin path: `~/.hermes/hermes-agent/plugins/hermes-token-analytics/`
2. **User plugin path**, preferred for a normal operator install
   - resulting plugin path: `~/.hermes/plugins/hermes-token-analytics/`

Preferred default: use the **user plugin path** unless you are intentionally working inside a bundled Hermes checkout.

### Bundled checkout install

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

### User plugin install

If you are doing a normal user-level install instead of editing a Hermes checkout in place, copy this repo subdirectory into:

```text
~/.hermes/plugins/hermes-token-analytics
```

Use the contents of:

```text
plugins/hermes-token-analytics/
```

The main operational point is simple: copy the plugin directory, not the monorepo root.

### Verify the installed version before continuing

Set `INSTALLED_PLUGIN_DIR` to the install target you actually chose:

```bash
# User plugin install (preferred):
INSTALLED_PLUGIN_DIR="${HERMES_HOME:-$HOME/.hermes}/plugins/hermes-token-analytics"

# Bundled checkout install instead:
# INSTALLED_PLUGIN_DIR="${HERMES_HOME:-$HOME/.hermes}/hermes-agent/plugins/hermes-token-analytics"
```

Then read the source and installed manifests and confirm they match:

```bash
python3 -c 'import pathlib, sys; [print(f"{p}: " + next(line for line in pathlib.Path(p).read_text().splitlines() if line.startswith("version:"))) for p in sys.argv[1:]]' \
  plugins/hermes-token-analytics/plugin.yaml \
  "$INSTALLED_PLUGIN_DIR/plugin.yaml"
```

If you supplied a non-default target to the install helper, set `INSTALLED_PLUGIN_DIR` to that exact resulting plugin directory. Do not continue with an older installed version. Report both versions in the completion summary so fleet operators can distinguish “enabled” from “up to date.”

## Step 2. Enable the plugin in Hermes

Enable the plugin by its path-derived key:

```bash
hermes plugins enable hermes-token-analytics
```

Then restart the gateway so Hermes reloads the plugin command surface:

```bash
hermes gateway restart
```

If Hermes refuses to restart itself from inside the running gateway process, record this as an external-shell blocker and give the user the exact command above. **Continue with configuration, wrapper creation, cron reconciliation, and scheduled-path validation wherever the already-loaded command surface allows it.** Do not use the restart boundary as a reason to omit scheduling.

Then verify Hermes sees it:

```bash
hermes plugins list
```

What you want to see:

- `hermes-token-analytics` listed as enabled
- the plugin commands available after the restart

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

Important: a successful `hermes token-analytics sync` only proves the plugin works manually.
It does **not** mean continuous reporting is active.
Continuous reporting requires a cron job.

If `sync` fails, stop here and fix config before adding cron.

## Step 5. Create or reconcile the scheduled job

First inspect the active profile before creating anything:

```bash
hermes cron list --all
```

Install the cron wrapper once, or refresh it during an upgrade before creating or repairing the job:

```bash
hermes token-analytics install-cron-wrapper --force
```

Apply exactly one of these cases:

### Case A: no `token-analytics-sync` job exists

Create it:

```bash
hermes cron create "every 15m" \
  --name "token-analytics-sync" \
  --script token_analytics_sync.sh \
  --no-agent
```

### Case B: exactly one job exists

If its cadence, script, name, or no-agent mode differs, repair that same job instead of creating another:

```bash
hermes cron edit <job_id> \
  --schedule "every 15m" \
  --name "token-analytics-sync" \
  --script token_analytics_sync.sh \
  --no-agent
hermes cron resume <job_id>
```

If it is already correct and enabled, reuse it unchanged.

### Case C: duplicate jobs exist

Choose one canonical job, repair it with the Case B command, then remove every duplicate by its real ID:

```bash
hermes cron remove <duplicate_job_id>
```

Run `hermes cron list --all` again and do not continue until exactly one enabled `token-analytics-sync` job remains and it points to `token_analytics_sync.sh`.

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

- the job is enabled;
- the schedule and active profile are correct;
- the job points to the expected wrapper;
- the cron-triggered run completes successfully;
- the run reports a successful ingest response; and
- dashboard freshness advances after the scheduled-path run.

Do not use the earlier manual sync as evidence for this step. Record the cron job ID and the scheduled-path result in the completion summary.

## Production readiness checklist

- [ ] source and installed plugin versions match
- [ ] plugin copied from `plugins/hermes-token-analytics/` into the intended install target
- [ ] plugin enabled
- [ ] gateway restarted and plugin reload verified
- [ ] `hermes token-analytics doctor` passes
- [ ] `hermes token-analytics show-config` is correct
- [ ] `hermes token-analytics sync` succeeds
- [ ] `hermes token-analytics install-cron-wrapper --force` run
- [ ] exactly one enabled `token-analytics-sync` cron job exists
- [ ] `hermes cron list --all` shows the intended profile, wrapper, and cadence
- [ ] one cron-triggered run succeeds
- [ ] dashboard or ingest freshness advances from the cron-triggered run

If any box remains unchecked, report the result as **partial/incomplete**, not “installed successfully.”

## Required completion report

End every installation or upgrade task with this evidence block:

```text
Installation status: COMPLETE | PARTIAL/BLOCKED
Source plugin version: <version>
Installed plugin version: <version>
Install target: <absolute path>
Plugin enabled: yes/no
Gateway reload: completed | blocked — <exact command/action>
Doctor: pass/fail
Manual sync: pass/fail — rowsWritten=<n>, syncedAt=<timestamp>
Cron wrapper: <absolute path> | missing
Cron job: <job_id> | missing — enabled=<yes/no>, schedule=<value>, profile=<name>
Cron-triggered run: pass/fail/not run — <result>
Scheduled freshness verified: yes/no — <timestamp or ingest evidence>
Remaining blockers: none | <explicit list>
```

Do not bury missing scheduling in prose after announcing success. The first line must say `PARTIAL/BLOCKED` whenever the wrapper, cron job, scheduled run, or required gateway reload remains incomplete.

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

## Fast path without duplicate-job risk

Run the common steps first:

```bash
# from this repo root
plugins/hermes-token-analytics/scripts/install-local-plugin.sh
hermes plugins enable hermes-token-analytics
hermes gateway restart

# configure env for the right Hermes profile, then validate manually
hermes token-analytics doctor
hermes token-analytics show-config
hermes token-analytics sync

# refresh the wrapper and inspect scheduler state before mutating jobs
hermes token-analytics install-cron-wrapper --force
hermes cron list --all
```

Then apply **exactly one** Step 5 case based on that list: create when absent, edit/resume when one job is wrong or paused, or repair one and remove duplicates. Finally:

```bash
hermes cron list --all
hermes cron run <canonical_job_id>
```

Do not turn this into an unconditional `cron create`; upgrades must preserve and repair the existing canonical job rather than duplicate it.
