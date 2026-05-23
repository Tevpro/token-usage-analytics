# Hermes token analytics plugin source

This directory is the source-of-truth copy of the Hermes token analytics plugin inside the monorepo.

## What lives here

- `plugins/observability/token_analytics/` — the plugin files as they should exist inside a Hermes checkout
- `tests/` — plugin validation tests
- `scripts/install-local-plugin.sh` — helper to copy the plugin into a local Hermes repo checkout

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
PYTHONPATH=hermes-token-analytics-plugin python3 -m pytest hermes-token-analytics-plugin/tests -q
```

## Local install helper

```bash
hermes-token-analytics-plugin/scripts/install-local-plugin.sh /path/to/hermes-agent
```

Default target if no argument is passed:

- `~/.hermes/hermes-agent`
