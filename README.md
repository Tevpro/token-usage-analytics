## TL;DR

This repo is an internal token-usage analytics app built with TanStack Start and deployed on Cloudflare Workers. It now supports pulling real OpenAI organization usage and cost data into Cloudflare D1, then serving the dashboard from D1 for cheap, fast reads.

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

## Product direction

The target UX is a dense, operator-facing analytics surface, not a marketing dashboard. The visual reference we preserved:

- crisp header with lightweight tabs
- compact control bar for workspace, environment, and date range
- six dense panels with low-friction chart scanning
- issue list beside metrics, so anomalies are visible without leaving the page
- operational table at the bottom for trace-level or day-level inspection

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm run build
```

## D1 workflow

Generate SQL if the schema changes:

```bash
npm run db:generate
```

Apply migrations locally:

```bash
npm run cf:d1:migrate:local
```

Apply migrations remotely once the real D1 database exists:

```bash
npm run cf:d1:migrate:remote
```

## Deploy to Cloudflare Workers

```bash
npm run deploy
```

Before that, create the D1 database, paste the real `database_id` into `wrangler.jsonc`, and follow:
- `docs/cloudflare-deployment.md`
- `docs/github-actions.md`

GitHub Actions deployment is wired in two lanes after you add the required repository secrets:
- PRs deploy a Cloudflare preview worker at `https://token-usage-analytics-pr-<PR_NUMBER>.tevpro.workers.dev`
- `main` deploys production and applies remote D1 migrations

Required repository secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Next build slices

1. Ingest raw usage events from the chosen source of truth
2. Materialize daily rollups into D1
3. Replace mock dashboard data with server-backed queries
4. Add filtering, saved views, and anomaly alerting
5. Add auth and workspace scoping if this expands past internal use

## GitHub board

Project board: https://github.com/orgs/Tevpro/projects/32

Recommended execution order:
1. #3 Ingestion contract
2. #4 Daily rollups and backfill logic
3. #10 Cloudflare D1 bootstrap and deploy config
4. #5 Live D1 dashboard queries
5. #6 Drilldowns and persistent filters
6. #7 Issue detection and guardrails
7. #9 Hardening and CI
8. #8 Auth and workspace scoping, if needed
