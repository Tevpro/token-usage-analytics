# Hermes token analytics plugin source

This directory is the source-of-truth copy of the Hermes token analytics plugin inside the monorepo.

> [!WARNING]
> This repository is a monorepo. The Hermes plugin is **not** at the repo root.
> Do **not** install the repo root directly with `hermes plugins install <repo-url>`.
> The actual plugin source lives at `plugins/hermes-token-analytics/`.

## What lives here

- `plugins/hermes-token-analytics/` — the plugin files as they should exist inside a Hermes checkout
- `plugins/hermes-token-analytics/tests/` — plugin validation tests
- `plugins/hermes-token-analytics/scripts/install-local-plugin.sh` — helper to copy the plugin into a local Hermes repo checkout
- `docs/hermes-token-analytics-install-runbook.md` — exact operator procedure for install, validation, and cron setup

## Why this exists

We wanted one repo to own:

- the Cloudflare dashboard
- the ingest contract
- the Hermes sync plugin
- the operator docs

That avoids the old split-brain setup where the product repo and the Hermes implementation lived in different places.

## Local test command

Run from repo root:

```bash
python3 -m pytest plugins/hermes-token-analytics/tests -q
```

## Local install helper

There are two install patterns:

1. **Bundled checkout install**, useful when you are modifying a Hermes repo checkout directly
2. **User plugin install**, preferred for normal operator usage under `~/.hermes/plugins/hermes-token-analytics`

Bundled checkout helper:

```bash
plugins/hermes-token-analytics/scripts/install-local-plugin.sh /path/to/hermes-agent
```

Default target if no argument is passed:

- `~/.hermes/hermes-agent`

The install helper also writes a small compatibility shim at `plugins/observability/token_analytics/` inside the target Hermes checkout so older `plugins.enabled` entries keep working during migration.

After enabling the plugin, restart the gateway:

```bash
hermes plugins enable hermes-token-analytics
hermes gateway restart
```

A successful manual `hermes token-analytics sync` proves the plugin works manually. It does **not** prove continuous reporting is active. For that, create the cron job described in `docs/hermes-token-analytics-install-runbook.md`.
