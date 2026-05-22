# AI Build Prompt Pack

## TL;DR

Use staged prompts. Do not ask one agent to invent the whole system in one pass.

## Master instruction block

Read `docs/requirements.md` and `docs/implementation-plan.md` before changing anything.

Rules:
- Only implement the scoped slice.
- Do not invent adjacent features.
- Preserve the operator-style dashboard UX.
- Prefer D1 rollups over raw-event dashboard queries.
- Keep code modular.
- Add or update tests for business-critical logic.
- Run relevant verification commands before finishing.
- Commit with a clear message.

## Prompt 1 — Foundation review

Review the current repo and tighten the Cloudflare + D1 foundation without changing product scope. Confirm the dashboard shell builds, the D1 schema is coherent, and the deployment docs are accurate. Fix anything structurally off, then run validation commands.

## Prompt 2 — Ingestion contract

Implement the ingestion contract for token usage events.

Scope:
- define canonical input schema
- add import/server route
- add validation and idempotency behavior
- document the expected payload format

Do not build alerts, auth, or complex drilldowns in this slice.

## Prompt 3 — Rollup materialization

Implement daily rollup generation from the ingestion source into D1.

Scope:
- materialize `daily_usage_rollups`
- materialize `model_daily_usage`
- materialize `tool_daily_usage`
- materialize `issue_events`
- add tests for cost math and date bucketing

Do not redesign the UI in this slice.

## Prompt 4 — Live overview queries

Replace mock overview data with live D1-backed queries.

Scope:
- overview route loaders/server functions
- workspace/environment/date filters
- consistent panel updates from shared query inputs
- empty/error states

Do not add extra dashboard pages unless required for the data flow.

## Prompt 5 — Drilldowns

Add drilldown routes for model, tool, and day detail views.

Scope:
- preserve overview page behavior
- use search params consistently
- keep the same visual language

Do not add RBAC or budget alerts here.

## Prompt 6 — Issue detection

Add anomaly detection rules and make the issue panel live.

Scope:
- spend spike detection
- retry spike detection
- latency spike detection
- cache drop detection

Keep the rules explicit and testable.

## Prompt 7 — Access control, only if needed

If the app needs broader internal distribution, add auth and workspace scoping.

Scope:
- route protection
- server-side access checks
- minimal role model

Do not add complicated admin tooling unless there is a real distribution need.
