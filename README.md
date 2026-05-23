## TL;DR

This repo is now a small monorepo:

- `apps/dashboard/` — the Cloudflare Workers + D1 analytics app
- `hermes-token-analytics-plugin/` — the Hermes-native plugin source that exports `state.db` rollups into the dashboard ingest endpoint
- `docs/` — shared operator and deployment documentation

The goal is simple: keep the dashboard, ingest contract, plugin source, and operational docs in one place instead of splitting the truth across repos.

## Repo layout

```text
apps/
  dashboard/
hermes-token-analytics-plugin/
docs/
.github/workflows/
```

## App commands

Run these from `apps/dashboard/`:

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm run build
npm run cf:d1:migrate:local
npm run cf:d1:migrate:remote
npm run deploy
```

## Hermes plugin source

The Hermes plugin source lives at:

- `hermes-token-analytics-plugin/plugins/observability/token_analytics/`

Supporting files:

- install helper: `hermes-token-analytics-plugin/scripts/install-local-plugin.sh`
- tests: `hermes-token-analytics-plugin/tests/`
- operator guide: `docs/hermes-token-analytics-plugin.md`

## CI / deploy model

GitHub Actions is path-aware:

- app changes validate and deploy from `apps/dashboard/`
- plugin changes run Python/plugin validation
- Cloudflare deploy workflows only fire for dashboard/deploy-path changes

See:

- `docs/github-actions.md`
- `docs/cloudflare-deployment.md`

## Product docs

- `docs/requirements.md`
- `docs/implementation-plan.md`
- `docs/ai-build-prompts.md`
- `docs/cloudflare-deployment.md`
- `docs/github-actions.md`
- `docs/hermes-token-analytics-plugin.md`
- `docs/hermes-sidecar-sync.md`

## GitHub board

Project board: https://github.com/orgs/Tevpro/projects/32
