## TL;DR

This repo is now a small monorepo:

- `apps/dashboard/` — the Cloudflare Workers + D1 analytics app
- `plugins/hermes-token-analytics/` — the Hermes-native plugin source that exports `state.db` rollups into the dashboard ingest endpoint
- `docs/` — shared operator and deployment documentation

The goal is simple: keep the dashboard, ingest contract, plugin source, and operational docs in one place instead of splitting the truth across repos.

For Hermes ingestion operations, the canonical operator guides are:

- `docs/hermes-token-analytics-plugin.md`
- `docs/hermes-token-analytics-install-runbook.md`

## What is in here

- TanStack Start app scaffolded for Cloudflare Workers
- Dashboard shell for daily token, cost, request, latency, model, and tool analytics
- D1 schema for workspaces, daily rollups, model usage, tool usage, and issue events
- Initial migration for local and remote D1 environments
- Product docs:
  - `docs/requirements.md`
  - `docs/implementation-plan.md`
  - `docs/ai-build-prompts.md`
  - `docs/cloudflare-deployment.md`
  - `docs/hermes-token-analytics-plugin.md`
  - `docs/hermes-token-analytics-install-runbook.md`
  - `docs/hermes-sidecar-sync.md` (migration pointer to the plugin doc)

## Product direction

The target UX is a dense, operator-facing analytics surface, not a marketing dashboard. The visual reference we preserved:

- crisp header with lightweight tabs
- compact control bar for workspace, environment, and date range
- six dense panels with low-friction chart scanning
- issue list beside metrics, so anomalies are visible without leaving the page
- operational table at the bottom for trace-level or day-level inspection

## Repo layout

```text
apps/
  dashboard/
plugins/
  hermes-token-analytics/
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
npm run cf:d1:bootstrap:local
npm run cf:d1:migrate:remote
npm run deploy
```

If a fresh worktree has no local D1 data yet, run `npm run cf:d1:bootstrap:local` before `npm run dev`. It applies local migrations, wipes/reseeds the demo workspaces, and inserts recent daily plus hourly sample data so the dashboard renders immediately.

## Hermes plugin source


The Hermes plugin source lives at:

- `plugins/hermes-token-analytics/`

Supporting files:

- install helper: `plugins/hermes-token-analytics/scripts/install-local-plugin.sh`
- tests: `plugins/hermes-token-analytics/tests/`
- operator guide: `docs/hermes-token-analytics-plugin.md`
- install runbook: `docs/hermes-token-analytics-install-runbook.md`
- install helper also writes a legacy shim for `plugins/observability/token_analytics` in target Hermes checkouts

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
