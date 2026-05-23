# Legacy sidecar doc: superseded by the Hermes plugin

This file is intentionally kept as a migration pointer.

The earlier sidecar-era flow in this repo is no longer the canonical operator path.

Use the Hermes-native plugin documentation instead:

- [`docs/hermes-token-analytics-plugin.md`](./hermes-token-analytics-plugin.md)

## What changed

Old guidance assumed:

- a separate Python exporter
- a shell wrapper
- sidecar-style scheduling

Current guidance assumes:

- a **Hermes-native Python plugin**
- operator commands exposed as:
  - `hermes token-analytics doctor`
  - `hermes token-analytics show-config`
  - `hermes token-analytics sync`
- **Hermes cron** owns schedule timing
- the plugin owns sync behavior and configuration

## Migration summary

If you were following the old doc:

- replace sidecar env names with the `HERMES_TOKEN_ANALYTICS_*` plugin env vars
- replace direct script execution with `hermes token-analytics sync`
- replace shell/cron scheduling assumptions with `hermes cron ...`

## Canonical operator doc

For setup, validation, cron operations, verification, and failure modes, see:

- [`docs/hermes-token-analytics-plugin.md`](./hermes-token-analytics-plugin.md)
