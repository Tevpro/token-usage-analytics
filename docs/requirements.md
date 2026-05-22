# TL;DR

Build an internal analytics app that shows daily token usage, estimated cost, model mix, tool mix, latency, and issue signals in one operator-friendly dashboard. v1 should run on Cloudflare Workers, persist rollups in D1, and prioritize trustworthy daily visibility over fancy drilldowns.

# Product Summary

Teams using multiple AI agents need a fast way to answer basic operating questions without reading logs or invoice exports:

- How many tokens did we use today?
- Which models drove the spend?
- Which tools or workflows are noisy?
- Are retries, errors, or latency getting worse?
- Which traces or days need attention?

This app is the internal answer. It should feel like a compact observability console, not a generic BI page.

# Goals

1. Show daily token usage and estimated cost by workspace and environment.
2. Break usage down by model and tool.
3. Surface errors, retry-driven waste, and anomaly issues in the same workflow.
4. Keep the query path cheap enough to run on Cloudflare Workers with D1.
5. Provide a foundation that can later support alerting, exports, and chargeback.

# Non-Goals

- Full trace replay in v1
- Invoice reconciliation or billing automation
- Real-time streaming dashboards at sub-second latency
- Complex RBAC beyond simple internal access if the audience stays small
- Custom chart-builder or user-defined metrics engine

# Primary Users

## 1. AI Operations Lead
Needs daily visibility into spend, token volume, latency, and breakage.

## 2. Engineering Manager
Needs to spot prompt regressions, retry storms, or tool-level inefficiency.

## 3. Finance / Ops Stakeholder
Needs credible daily cost rollups and trend direction.

# UX / UI Requirements

## Core layout

Preserve the reference pattern:

- top title area with lightweight tabs (`Overview`, `Models`, `Tools`)
- compact toolbar for workspace, environment, date range, and search
- first row of metric panels for traffic, latency, and issue feed
- second row for LLM calls, tokens used, and tool calls
- bottom table for day-level or trace-level inspection

## Design principles

- Dense, clear, operator-grade
- Minimal wasted space
- Neutral base palette with a few deliberate accents
- Crisp borders, restrained shadows, readable hierarchy
- Fast scan value, more newsroom than card casino

## Interaction requirements

- Filter by workspace
- Filter by environment
- Filter by date range
- Search for traces, users, tags, or models
- Click a panel to drill into the relevant slice later
- Keep chart legends simple and always visible

# Functional Requirements

## Data model

The system should support these core entities:

- `workspaces`
- `daily_usage_rollups`
- `model_daily_usage`
- `tool_daily_usage`
- `issue_events`

## Dashboard metrics

v1 must show:

- total tokens
- estimated cost
- request volume
- error rate
- average latency
- p95 latency
- model mix
- tool call mix
- issue/anomaly list

## Ingestion

The app must support a daily ingestion path from a source of truth such as:

- agent execution logs
- gateway usage exports
- provider usage exports
- internal event webhooks

v1 can start with a scheduled import job or manual batch import. The important thing is durable daily rollups, not perfect real-time ingest.

## Query strategy

The UI should read from pre-aggregated daily tables, not raw event scans, for most dashboard queries. That is the only sane way to keep Workers + D1 responsive as usage scales.

## Search and drilldown

v1 can keep drilldown shallow, but it should leave room for:

- day detail view
- model detail view
- tool detail view
- trace detail view

# Technical Requirements

- Framework: TanStack Start
- Runtime: Cloudflare Workers
- Database: Cloudflare D1
- Styling: Tailwind v4 + shadcn/ui
- Data fetching: TanStack loader/server-function pattern, Query where helpful
- Migrations: SQL migrations committed in repo

# Non-Functional Requirements

- Fast first load for the dashboard
- Server-rendered shell where practical
- Query cost low enough for frequent internal usage
- Clear deploy path via Wrangler
- Easy local development with mock data before live ingest is ready

# Acceptance Criteria

## v1 dashboard acceptance

- User can open the app and see daily token usage for the selected window
- User can see model and tool breakdowns without leaving the main page
- User can identify high-error or high-cost days quickly
- User can inspect a day-level table for verification
- Dashboard works on Cloudflare Workers deployment target

## v1 engineering acceptance

- Repo contains D1 schema and migration files
- Repo contains Cloudflare deployment config
- Repo contains implementation plan and issue pack
- UI runs locally with mock data
- There is a clear path to swap in live D1 queries

# Deferred Items

- real-time streaming updates
- Slack alerts
- budget thresholds and notifications
- chargeback by team or client
- export to CSV/PDF
- per-user usage analytics
