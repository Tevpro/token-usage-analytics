# Token Usage Analytics Implementation Plan

> For Hermes: execute this in vertical slices, not as one giant swing.

## Goal

Ship an internal TanStack Start app on Cloudflare Workers that provides daily token-usage analytics with D1-backed rollups and an operator-friendly dashboard.

## Architecture

Use Cloudflare Workers for the app runtime, D1 for durable rollups, TanStack Start loaders/server functions for server-side data access, and a dashboard UI that reads cheap pre-aggregated daily tables instead of raw event logs.

## Tech stack

- TanStack Start
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- Tailwind v4
- shadcn/ui

---

## Slice 1 — Foundation and deployment wiring

**Objective:** Lock in the app shell and platform constraints.

**Deliverables:**
- TanStack Start scaffold
- Cloudflare `wrangler.jsonc`
- D1 schema and first migration
- Dashboard shell using mock data
- README and deployment docs

**Verification:**
- `npm run typecheck`
- `npm run lint`
- `npm run build`

---

## Slice 2 — Ingestion contract

**Objective:** Define the raw input shape and make sure data lands consistently.

**Tasks:**
1. Choose the source of truth for token usage events.
2. Define the canonical ingestion payload.
3. Create a server route or worker task that accepts/imports those events.
4. Validate inputs and reject malformed payloads.
5. Add idempotency rules so the same batch cannot double-count usage.

**Files likely touched:**
- `src/routes/api/*`
- `src/lib/ingestion/*`
- `src/db/schema.ts`
- `docs/requirements.md`

**Verification:**
- sample payload imports succeed
- duplicate import is ignored or merged safely

---

## Slice 3 — Daily rollup materialization

**Objective:** Convert raw usage into cheap daily query tables.

**Tasks:**
1. Add raw-event tables if needed.
2. Implement rollup job logic.
3. Populate `daily_usage_rollups`, `model_daily_usage`, `tool_daily_usage`, and `issue_events`.
4. Add tests for cost math and date bucketing.
5. Add a rerun path for backfills.

**Key rule:** build this before fancy filters. Without rollups, the rest is lipstick on a billing fire.

---

## Slice 4 — Live dashboard queries

**Objective:** Replace mock data with D1-backed queries.

**Tasks:**
1. Add query helpers for the overview page.
2. Add workspace/environment/date filtering.
3. Return model and tool breakdowns from D1.
4. Return issue feed entries from `issue_events`.
5. Add empty/error states.

**Verification:**
- the dashboard renders entirely from database-backed data
- filter changes update all panels consistently

---

## Slice 5 — Drilldowns and detail routes

**Objective:** Make anomalies actionable.

**Tasks:**
1. Add model detail route.
2. Add tool detail route.
3. Add day detail route.
4. Add table sorting and paging.
5. Preserve filters in search params.

**Verification:**
- filter state survives refresh/share
- detail views match top-level numbers

---

## Slice 6 — Issue detection and guardrails

**Objective:** Surface waste and breakage automatically.

**Tasks:**
1. Define anomaly rules: spend spike, retry spike, latency spike, cache drop.
2. Generate `issue_events` during rollup.
3. Display severity and trend context.
4. Add basic threshold configuration.

**Verification:**
- seeded anomaly cases appear in the issue feed
- thresholds are predictable and documented

---

## Slice 7 — Auth and internal access

**Objective:** Protect the app if the audience expands.

**Tasks:**
1. Decide whether simple internal network controls are enough.
2. If not, add auth middleware.
3. Add workspace scoping if multiple teams use the tool.
4. Add audit logging for admin changes.

**Note:** do not front-load auth unless distribution requires it.

---

## Slice 8 — Hardening and polish

**Objective:** Make it safe to operate.

**Tasks:**
1. Add seed scripts and sample fixtures.
2. Add smoke tests for key routes.
3. Add CI checks.
4. Add observability for imports and rollup jobs.
5. Add fallback and recovery docs.

---

## Recommended execution order

1. Foundation
2. Ingestion contract
3. Rollup materialization
4. Live queries
5. Drilldowns
6. Issue detection
7. Auth if needed
8. Hardening

## Recommendation

Do not one-shot this build. The highest-leverage move is to keep the UI and data pipeline marching together in slices. Otherwise you get a pretty dashboard with no trustworthy numbers, which is just a more expensive spreadsheet lie.
