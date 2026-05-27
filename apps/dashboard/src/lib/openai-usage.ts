import type { CloudflareAppEnv } from '#/lib/runtime'
import type {
  DashboardIssueByDay,
  DashboardModelDailyUsage,
  DashboardProjectOption,
  DashboardSnapshot,
} from '#/lib/token-analytics'
import {
  buildFallbackDashboardSnapshot,
  buildSnapshotFromRollups,
  calculateCachedShare,
} from '#/lib/token-analytics'

type DailyRollupRow = DashboardProjectOption & {
  cachedTokens: number
  cost: number
  createdAt: number
  day: string
  environment: string
  inputTokens: number
  outputTokens: number
  requests: number
  totalTokens: number
}

type ModelSummaryRow = {
  cost: number
  model: string
  provider: string
  requests: number
  tokens: number
}

type ModelUsageRow = DashboardProjectOption &
  ModelSummaryRow & {
    day: string
  }

type IssueRow = DashboardProjectOption & {
  count: number
  day: string
  severity: 'high' | 'medium' | 'low'
  title: string
}

type WorkspaceRecord = {
  id: string
  name: string
  provider: string
  slug: string
}

type WorkspaceSelection = {
  latestCreatedAt: number
  latestDay: string
  workspace: WorkspaceRecord
}

type OpenAiUsageBucket = {
  end_time?: number
  results?: Array<{
    input_cached_tokens?: number | null
    input_tokens?: number | null
    model?: string | null
    num_model_requests?: number | null
    output_tokens?: number | null
  }>
  start_time: number
}

type OpenAiUsageResponse = {
  data?: OpenAiUsageBucket[]
}

type OpenAiCostBucket = {
  results?: Array<{
    amount?: {
      value?: number | string | null
    } | null
  }>
  start_time: number
}

type OpenAiCostResponse = {
  data?: OpenAiCostBucket[]
}

type DayAccumulator = {
  avgLatencyMs: number
  cachedTokens: number
  cost: number
  day: string
  errorCount: number
  inputTokens: number
  issues: Array<{
    count: number
    metadata?: Record<string, unknown>
    severity: 'high' | 'medium' | 'low'
    title: string
  }>
  models: Map<string, { provider: string; requests: number; tokens: number; cost?: number }>
  outputTokens: number
  p95LatencyMs: number
  requests: number
  totalTokens: number
}

type SyncResult = {
  rowsWritten: number
  sourceLabel: string
  syncedAt: string
}

type SnapshotLoadResult = {
  snapshot: DashboardSnapshot
  syncResult?: SyncResult
}

export type ExternalIngestPayload = {
  environment?: string
  generatedAt?: string
  rollups: Array<{
    avgLatencyMs?: number
    cachedTokens?: number
    errorCount?: number
    estimatedCostUsd?: number
    inputTokens: number
    issues?: Array<{
      count?: number
      metadata?: Record<string, unknown>
      severity: 'high' | 'medium' | 'low'
      title: string
    }>
    models?: Array<{
      estimatedCostUsd?: number
      model: string
      provider?: string
      requests?: number
      tokens?: number
    }>
    outputTokens: number
    p95LatencyMs?: number
    requests: number
    totalTokens?: number
    usageDate: string
  }>
  sourceLabel?: string
  workspace?: {
    name?: string
    provider?: string
    slug?: string
  }
}

const DEFAULT_DAYS_BACK = 30
const FRESHNESS_WINDOW_MS = 2 * 60 * 60 * 1000
const OPENAI_PROVIDER = 'OpenAI'

export async function loadDashboardSnapshotForRequest(env: CloudflareAppEnv): Promise<SnapshotLoadResult> {
  const selectedWorkspaces = await selectDashboardWorkspaces(env)
  if (selectedWorkspaces.length > 0) {
    const snapshot = await loadSnapshotFromD1(env, selectedWorkspaces)
    return { snapshot }
  }

  if (env.OPENAI_API_KEY) {
    try {
      const syncResult = await syncOpenAiUsageToD1(env)
      const workspaces = await selectDashboardWorkspaces(env, getOpenAiWorkspaceConfig(env).slug)
      if (workspaces.length > 0) {
        const snapshot = await loadSnapshotFromD1(env, workspaces, syncResult.sourceLabel)
        return { snapshot, syncResult }
      }
    } catch (error) {
      return {
        snapshot: buildFallbackDashboardSnapshot(
          `OpenAI fallback sync failed before any D1 data was cached. ${toErrorMessage(error)}`,
        ),
      }
    }
  }

  return {
    snapshot: buildFallbackDashboardSnapshot(
      'No D1 rollups are available yet. Configure the Hermes token analytics plugin ingestion or wire the OpenAI fallback secret to replace sample data.',
    ),
  }
}

export async function ingestExternalRollupsToD1(
  env: CloudflareAppEnv,
  payload: ExternalIngestPayload,
): Promise<SyncResult> {
  if (payload.rollups.length === 0) {
    throw new Error('Ingest payload did not include any rollups.')
  }

  const workspace = getExternalWorkspaceConfig(payload)
  const environment = payload.environment || env.APP_ENV || 'production'
  const nowMs = Date.parse(payload.generatedAt || '') || Date.now()
  const dayEntries = payload.rollups
    .map((rollup) => normalizeExternalRollup(rollup, workspace.provider))
    .sort((left, right) => left.day.localeCompare(right.day))

  await dbEnsureWorkspace(env.DB, workspace)

  const firstDay = dayEntries[0].day
  const lastDay = dayEntries[dayEntries.length - 1].day

  await env.DB.batch([
    env.DB.prepare('DELETE FROM issue_events WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?').bind(
      workspace.id,
      firstDay,
      lastDay,
    ),
    env.DB.prepare(
      'DELETE FROM daily_usage_rollups WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
    ).bind(workspace.id, firstDay, lastDay),
  ])

  const statements: D1PreparedStatement[] = []

  for (const dayEntry of dayEntries) {
    const rollupId = `${workspace.id}:${dayEntry.day}`
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_usage_rollups (
          id, workspace_id, usage_date, environment, requests, total_tokens, input_tokens,
          output_tokens, cached_tokens, estimated_cost_usd, error_count, avg_latency_ms,
          p95_latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        rollupId,
        workspace.id,
        dayEntry.day,
        environment,
        dayEntry.requests,
        dayEntry.totalTokens,
        dayEntry.inputTokens,
        dayEntry.outputTokens,
        dayEntry.cachedTokens,
        roundCurrency(dayEntry.cost),
        dayEntry.errorCount,
        Math.max(0, Math.round(dayEntry.avgLatencyMs)),
        Math.max(0, Math.round(dayEntry.p95LatencyMs)),
        nowMs,
      ),
    )

    for (const [model, values] of [...dayEntry.models.entries()].sort((left, right) => right[1].tokens - left[1].tokens)) {
      const modelId = `${rollupId}:${values.provider}:${model}`
      statements.push(
        env.DB.prepare(
          'INSERT INTO model_daily_usage (id, rollup_id, model, provider, requests, tokens, estimated_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          modelId,
          rollupId,
          model,
          values.provider,
          values.requests,
          values.tokens,
          roundCurrency(values.cost || 0),
        ),
      )
    }
  }

  const issueStatements = buildIssueStatements(env.DB, workspace.id, dayEntries, nowMs)
  await env.DB.batch([...statements, ...issueStatements])

  return {
    rowsWritten: dayEntries.length,
    sourceLabel: payload.sourceLabel || `Live ${workspace.provider} plugin data`,
    syncedAt: new Date(nowMs).toISOString(),
  }
}

export async function syncOpenAiUsageToD1(env: CloudflareAppEnv): Promise<SyncResult> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing from the Worker runtime.')
  }

  const workspace = getOpenAiWorkspaceConfig(env)
  const environment = env.OPENAI_USAGE_ENVIRONMENT || env.APP_ENV || 'production'
  const daysBack = getDaysBack(env)
  const now = new Date()
  const startDay = shiftUtcDay(formatUtcDay(now), -(daysBack - 1))
  const startTime = Math.floor(new Date(`${startDay}T00:00:00Z`).getTime() / 1000)

  const [usageResponse, costResponse] = await Promise.all([
    fetchOpenAiUsage(apiKey, startTime, daysBack),
    fetchOpenAiCosts(apiKey, startTime, daysBack),
  ])

  const dayMap = new Map<string, DayAccumulator>()

  for (const bucket of usageResponse.data ?? []) {
    const day = formatUtcDayFromSeconds(bucket.start_time)
    const entry = getOrCreateDay(dayMap, day)

    for (const result of bucket.results ?? []) {
      const inputTokens = toNumber(result.input_tokens)
      const outputTokens = toNumber(result.output_tokens)
      const cachedTokens = toNumber(result.input_cached_tokens)
      const requests = toNumber(result.num_model_requests)
      const totalTokens = inputTokens + outputTokens
      const model = result.model || 'unknown-model'

      entry.requests += requests
      entry.inputTokens += inputTokens
      entry.outputTokens += outputTokens
      entry.cachedTokens += cachedTokens
      entry.totalTokens += totalTokens

      const modelEntry = entry.models.get(model) ?? {
        provider: OPENAI_PROVIDER,
        requests: 0,
        tokens: 0,
      }
      modelEntry.requests += requests
      modelEntry.tokens += totalTokens
      entry.models.set(model, modelEntry)
    }
  }

  for (const bucket of costResponse.data ?? []) {
    const day = formatUtcDayFromSeconds(bucket.start_time)
    const entry = getOrCreateDay(dayMap, day)
    entry.cost += (bucket.results ?? []).reduce((sum, result) => sum + toNumber(result.amount?.value), 0)
  }

  const dayEntries = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day))
  const nowMs = Date.now()

  await dbEnsureWorkspace(env.DB, workspace)
  if (dayEntries.length === 0) {
    return {
      rowsWritten: 0,
      sourceLabel: 'OpenAI connected, no usage returned',
      syncedAt: new Date(nowMs).toISOString(),
    }
  }

  const firstDay = dayEntries[0].day
  const lastDay = dayEntries[dayEntries.length - 1].day

  await env.DB.batch([
    env.DB.prepare('DELETE FROM issue_events WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?').bind(
      workspace.id,
      firstDay,
      lastDay,
    ),
    env.DB.prepare(
      'DELETE FROM daily_usage_rollups WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
    ).bind(workspace.id, firstDay, lastDay),
  ])

  const statements: D1PreparedStatement[] = []

  for (const dayEntry of dayEntries) {
    const rollupId = `${workspace.id}:${dayEntry.day}`
    statements.push(
      env.DB.prepare(
        `INSERT INTO daily_usage_rollups (
          id, workspace_id, usage_date, environment, requests, total_tokens, input_tokens,
          output_tokens, cached_tokens, estimated_cost_usd, error_count, avg_latency_ms,
          p95_latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      ).bind(
        rollupId,
        workspace.id,
        dayEntry.day,
        environment,
        dayEntry.requests,
        dayEntry.totalTokens,
        dayEntry.inputTokens,
        dayEntry.outputTokens,
        dayEntry.cachedTokens,
        roundCurrency(dayEntry.cost),
        nowMs,
      ),
    )

    for (const [model, values] of [...dayEntry.models.entries()].sort((left, right) => right[1].tokens - left[1].tokens)) {
      const allocatedCost =
        dayEntry.totalTokens > 0 ? roundCurrency((dayEntry.cost * values.tokens) / dayEntry.totalTokens) : 0
      const modelId = `${rollupId}:${values.provider}:${model}`
      statements.push(
        env.DB.prepare(
          'INSERT INTO model_daily_usage (id, rollup_id, model, provider, requests, tokens, estimated_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          modelId,
          rollupId,
          model,
          values.provider,
          values.requests,
          values.tokens,
          allocatedCost,
        ),
      )
    }
  }

  const issueStatements = buildIssueStatements(env.DB, workspace.id, dayEntries, nowMs)
  await env.DB.batch([...statements, ...issueStatements])

  return {
    rowsWritten: dayEntries.length,
    sourceLabel: 'Live OpenAI usage data',
    syncedAt: new Date(nowMs).toISOString(),
  }
}

async function loadSnapshotFromD1(
  env: CloudflareAppEnv,
  selections: WorkspaceSelection[],
  sourceLabel = buildCombinedSourceLabel(selections),
): Promise<DashboardSnapshot> {
  const workspaceIds = selections.map((selection) => selection.workspace.id)
  const rows = await loadDailyRollups(env.DB, workspaceIds, getDaysBack(env))

  if (rows.length === 0) {
    return buildFallbackDashboardSnapshot('No D1 rollups were found for the selected projects.')
  }

  const firstDay = rows[0].day
  const lastDay = rows[rows.length - 1].day
  const models = await loadModelSummary(env.DB, workspaceIds, firstDay, lastDay)
  const modelRowsByDay = await loadModelUsageByDay(env.DB, workspaceIds, firstDay, lastDay)
  const issuesByDay = await loadIssues(env.DB, workspaceIds, firstDay, lastDay)
  const availableProjects = selections.map(({ workspace }) => ({
    projectId: workspace.id,
    projectName: workspace.name,
    projectProvider: workspace.provider,
    projectSlug: workspace.slug,
  }))
  const latestCreatedAt = Math.max(...selections.map((selection) => selection.latestCreatedAt || 0), Date.now())

  return buildSnapshotFromRollups({
    availableProjects,
    dailyRows: rows,
    environment: rows[rows.length - 1].environment,
    generatedAt: new Date(latestCreatedAt).toISOString(),
    issues: summarizeIssues(issuesByDay),
    issuesByDay,
    models,
    modelRowsByDay,
    selectedProjectIds: availableProjects.map((project) => project.projectId),
    sourceLabel,
    statusNote: buildCombinedStatusNote(selections),
    workspaceName: availableProjects.length === 1 ? availableProjects[0].projectName : 'All projects',
  })
}

async function selectDashboardWorkspaces(
  env: CloudflareAppEnv,
  preferredSlug?: string,
): Promise<WorkspaceSelection[]> {
  const slug = preferredSlug || env.DASHBOARD_WORKSPACE_SLUG || ''
  const rows = await env.DB
    .prepare(
      `SELECT workspaces.id as id,
              workspaces.slug as slug,
              workspaces.name as name,
              workspaces.provider as provider,
              MAX(daily_usage_rollups.created_at) as latestCreatedAt,
              MAX(daily_usage_rollups.usage_date) as latestDay
       FROM workspaces
       INNER JOIN daily_usage_rollups ON daily_usage_rollups.workspace_id = workspaces.id
       GROUP BY workspaces.id, workspaces.slug, workspaces.name, workspaces.provider
       ORDER BY CASE WHEN ? != '' AND workspaces.slug = ? THEN 0 ELSE 1 END,
                MAX(daily_usage_rollups.created_at) DESC,
                workspaces.name ASC`,
    )
    .bind(slug, slug)
    .all<{
      id: string
      latestCreatedAt: number
      latestDay: string
      name: string
      provider: string
      slug: string
    }>()

  return rows.results.map((row) => ({
    latestCreatedAt: row.latestCreatedAt,
    latestDay: row.latestDay,
    workspace: {
      id: row.id,
      name: row.name,
      provider: row.provider,
      slug: row.slug,
    },
  }))
}

async function dbEnsureWorkspace(db: D1Database, workspace: WorkspaceRecord) {
  await db
    .prepare(
      `INSERT INTO workspaces (id, slug, name, provider, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         id = excluded.id,
         name = excluded.name,
         provider = excluded.provider`,
    )
    .bind(workspace.id, workspace.slug, workspace.name, workspace.provider, Date.now())
    .run()
}

async function loadDailyRollups(db: D1Database, workspaceIds: string[], daysBack: number) {
  if (workspaceIds.length === 0) {
    return [] satisfies DailyRollupRow[]
  }

  const startDay = shiftUtcDay(formatUtcDay(new Date()), -(daysBack - 1))
  const placeholders = workspaceIds.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT
         daily_usage_rollups.usage_date as day,
         daily_usage_rollups.environment as environment,
         daily_usage_rollups.requests as requests,
         daily_usage_rollups.total_tokens as totalTokens,
         daily_usage_rollups.input_tokens as inputTokens,
         daily_usage_rollups.output_tokens as outputTokens,
         daily_usage_rollups.cached_tokens as cachedTokens,
         daily_usage_rollups.estimated_cost_usd as cost,
         daily_usage_rollups.created_at as createdAt,
         workspaces.id as projectId,
         workspaces.name as projectName,
         workspaces.provider as projectProvider,
         workspaces.slug as projectSlug
       FROM daily_usage_rollups
       INNER JOIN workspaces ON workspaces.id = daily_usage_rollups.workspace_id
       WHERE daily_usage_rollups.workspace_id IN (${placeholders})
         AND daily_usage_rollups.usage_date >= ?
       ORDER BY daily_usage_rollups.usage_date ASC, workspaces.name ASC`,
    )
    .bind(...workspaceIds, startDay)
    .all<DailyRollupRow>()

  return result.results
}

async function loadModelSummary(db: D1Database, workspaceIds: string[], startDay: string, endDay: string) {
  if (workspaceIds.length === 0) {
    return [] satisfies ModelSummaryRow[]
  }

  const placeholders = workspaceIds.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT
         model_daily_usage.model as model,
         model_daily_usage.provider as provider,
         SUM(model_daily_usage.requests) as requests,
         SUM(model_daily_usage.tokens) as tokens,
         SUM(model_daily_usage.estimated_cost_usd) as cost
       FROM model_daily_usage
       INNER JOIN daily_usage_rollups ON daily_usage_rollups.id = model_daily_usage.rollup_id
       WHERE daily_usage_rollups.workspace_id IN (${placeholders})
         AND daily_usage_rollups.usage_date BETWEEN ? AND ?
       GROUP BY model_daily_usage.model, model_daily_usage.provider
       ORDER BY tokens DESC`,
    )
    .bind(...workspaceIds, startDay, endDay)
    .all<ModelSummaryRow>()

  return result.results
}

async function loadModelUsageByDay(db: D1Database, workspaceIds: string[], startDay: string, endDay: string) {
  if (workspaceIds.length === 0) {
    return [] satisfies DashboardModelDailyUsage[]
  }

  const placeholders = workspaceIds.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT
         daily_usage_rollups.usage_date as day,
         model_daily_usage.model as model,
         model_daily_usage.provider as provider,
         model_daily_usage.requests as requests,
         model_daily_usage.tokens as tokens,
         model_daily_usage.estimated_cost_usd as cost,
         workspaces.id as projectId,
         workspaces.name as projectName,
         workspaces.provider as projectProvider,
         workspaces.slug as projectSlug
       FROM model_daily_usage
       INNER JOIN daily_usage_rollups ON daily_usage_rollups.id = model_daily_usage.rollup_id
       INNER JOIN workspaces ON workspaces.id = daily_usage_rollups.workspace_id
       WHERE daily_usage_rollups.workspace_id IN (${placeholders})
         AND daily_usage_rollups.usage_date BETWEEN ? AND ?
       ORDER BY daily_usage_rollups.usage_date ASC, model_daily_usage.tokens DESC`,
    )
    .bind(...workspaceIds, startDay, endDay)
    .all<ModelUsageRow>()

  return result.results satisfies DashboardModelDailyUsage[]
}

async function loadIssues(db: D1Database, workspaceIds: string[], startDay: string, endDay: string) {
  if (workspaceIds.length === 0) {
    return [] satisfies IssueRow[]
  }

  const placeholders = workspaceIds.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT issue_events.usage_date as day, issue_events.title as title, issue_events.count as count, issue_events.severity as severity,
              workspaces.id as projectId, workspaces.name as projectName, workspaces.provider as projectProvider, workspaces.slug as projectSlug
       FROM issue_events
       INNER JOIN workspaces ON workspaces.id = issue_events.workspace_id
       WHERE issue_events.workspace_id IN (${placeholders})
         AND issue_events.usage_date BETWEEN ? AND ?
       ORDER BY issue_events.occurred_at DESC`,
    )
    .bind(...workspaceIds, startDay, endDay)
    .all<IssueRow>()

  return result.results
}

function summarizeIssues(issueRows: DashboardIssueByDay[]) {
  const issueMap = new Map<string, DashboardIssueByDay>()

  for (const issue of issueRows) {
    const key = `${issue.severity}:${issue.title}`
    const current = issueMap.get(key)
    if (current) {
      current.count += issue.count
      continue
    }

    issueMap.set(key, { ...issue })
  }

  return [...issueMap.values()]
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
    .map(({ count, severity, title }) => ({ count, severity, title }))
}

function buildIssueStatements(db: D1Database, workspaceId: string, days: DayAccumulator[], nowMs: number) {
  const statements: D1PreparedStatement[] = []

  for (const day of days) {
    for (const [issueIndex, issue] of day.issues.entries()) {
      statements.push(
        db.prepare(
          'INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${workspaceId}:${day.day}:reported-${issueIndex}:${slugify(issue.title)}`,
          workspaceId,
          nowMs,
          day.day,
          issue.severity,
          issue.title,
          Math.max(0, issue.count),
          issue.metadata ? JSON.stringify(issue.metadata) : null,
        ),
      )
    }
  }

  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1]
    const current = days[index]

    if (previous.totalTokens > 0 && current.totalTokens >= previous.totalTokens * 1.5) {
      statements.push(
        db.prepare(
          'INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${workspaceId}:${current.day}:token-spike`,
          workspaceId,
          nowMs,
          current.day,
          'high',
          `Token volume jumped ${Math.round((current.totalTokens / previous.totalTokens) * 100)}% day over day`,
          1,
          JSON.stringify({ currentTokens: current.totalTokens, previousTokens: previous.totalTokens }),
        ),
      )
    }

    if (previous.cost > 0 && current.cost >= previous.cost * 1.5) {
      statements.push(
        db.prepare(
          'INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${workspaceId}:${current.day}:cost-spike`,
          workspaceId,
          nowMs,
          current.day,
          'medium',
          `Tracked cost spiked ${Math.round((current.cost / previous.cost) * 100)}% day over day`,
          1,
          JSON.stringify({ currentCost: current.cost, previousCost: previous.cost }),
        ),
      )
    }

    const cacheRate = calculateCachedShare(current)
    if (current.inputTokens > 0 && cacheRate < 0.05) {
      statements.push(
        db.prepare(
          'INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${workspaceId}:${current.day}:cache-drop`,
          workspaceId,
          nowMs,
          current.day,
          'medium',
          'Cached token share fell below 5%',
          1,
          JSON.stringify({ cacheRate }),
        ),
      )
    }
  }

  return statements
}

async function fetchOpenAiUsage(apiKey: string, startTime: number, daysBack: number) {
  return fetchOpenAiJson<OpenAiUsageResponse>(
    apiKey,
    `/v1/organization/usage/completions?start_time=${startTime}&bucket_width=1d&limit=${daysBack}`,
  )
}

async function fetchOpenAiCosts(apiKey: string, startTime: number, daysBack: number) {
  return fetchOpenAiJson<OpenAiCostResponse>(
    apiKey,
    `/v1/organization/costs?start_time=${startTime}&bucket_width=1d&limit=${daysBack}`,
  )
}

async function fetchOpenAiJson<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`https://api.openai.com${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${await response.text()}`)
  }

  const body: T = await response.json()
  return body
}

function getOpenAiWorkspaceConfig(env: CloudflareAppEnv): WorkspaceRecord {
  const slug = slugify(env.OPENAI_USAGE_WORKSPACE_SLUG || env.OPENAI_USAGE_WORKSPACE_NAME || 'openai-organization')
  return {
    id: `workspace:${slug}`,
    name: env.OPENAI_USAGE_WORKSPACE_NAME || 'OpenAI Organization',
    provider: OPENAI_PROVIDER,
    slug,
  }
}

function getExternalWorkspaceConfig(payload: ExternalIngestPayload): WorkspaceRecord {
  const name = payload.workspace?.name || 'Hermes Usage'
  const provider = payload.workspace?.provider || 'Hermes'
  const slug = slugify(payload.workspace?.slug || name)
  return {
    id: `workspace:${slug}`,
    name,
    provider,
    slug,
  }
}

function getDaysBack(env: CloudflareAppEnv) {
  const parsed = Number.parseInt(env.OPENAI_USAGE_DAYS_BACK || `${DEFAULT_DAYS_BACK}`, 10)
  if (Number.isNaN(parsed)) {
    return DEFAULT_DAYS_BACK
  }
  return Math.min(Math.max(parsed, 7), 90)
}

function normalizeExternalRollup(
  rollup: ExternalIngestPayload['rollups'][number],
  defaultProvider: string,
): DayAccumulator {
  const inputTokens = Math.max(0, rollup.inputTokens)
  const outputTokens = Math.max(0, rollup.outputTokens)
  const cachedTokens = Math.max(0, rollup.cachedTokens || 0)
  const totalTokens = Math.max(0, rollup.totalTokens || inputTokens + outputTokens + cachedTokens)
  const requests = Math.max(0, rollup.requests)
  const models = new Map<string, { provider: string; requests: number; tokens: number; cost?: number }>()

  for (const model of rollup.models || []) {
    const provider = model.provider || defaultProvider
    models.set(`${provider}:${model.model}`, {
      cost: model.estimatedCostUsd || 0,
      provider,
      requests: Math.max(0, model.requests || 0),
      tokens: Math.max(0, model.tokens || 0),
    })
  }

  return {
    avgLatencyMs: Math.max(0, rollup.avgLatencyMs || 0),
    cachedTokens,
    cost: Math.max(0, rollup.estimatedCostUsd || 0),
    day: rollup.usageDate,
    errorCount: Math.max(0, rollup.errorCount || 0),
    inputTokens,
    issues: (rollup.issues || []).map((issue) => ({
      count: Math.max(0, issue.count || 0),
      metadata: issue.metadata,
      severity: issue.severity,
      title: issue.title,
    })),
    models,
    outputTokens,
    p95LatencyMs: Math.max(0, rollup.p95LatencyMs || 0),
    requests,
    totalTokens,
  }
}

function getOrCreateDay(map: Map<string, DayAccumulator>, day: string) {
  const existing = map.get(day)
  if (existing) {
    return existing
  }

  const created: DayAccumulator = {
    avgLatencyMs: 0,
    cachedTokens: 0,
    cost: 0,
    day,
    errorCount: 0,
    inputTokens: 0,
    issues: [],
    models: new Map(),
    outputTokens: 0,
    p95LatencyMs: 0,
    requests: 0,
    totalTokens: 0,
  }

  map.set(day, created)
  return created
}

function buildSourceLabel(provider: string, createdAt: number) {
  return `${Date.now() - createdAt <= FRESHNESS_WINDOW_MS ? 'Live' : 'Cached'} ${provider} data`
}

function buildCombinedSourceLabel(selections: WorkspaceSelection[]) {
  if (selections.length === 0) {
    return 'Cached project data'
  }

  if (selections.length === 1) {
    const selection = selections[0]
    return buildSourceLabel(selection.workspace.provider, selection.latestCreatedAt)
  }

  const providers = [...new Set(selections.map((selection) => selection.workspace.provider))]
  const freshestCreatedAt = Math.max(...selections.map((selection) => selection.latestCreatedAt || 0), 0)
  const freshness = Date.now() - freshestCreatedAt <= FRESHNESS_WINDOW_MS ? 'Live' : 'Cached'
  return providers.length === 1 ? `${freshness} ${providers[0]} project data` : `${freshness} multi-source project data`
}

function buildStatusNote(provider: string, createdAt: number, latestDay: string) {
  return `${provider} rollups last updated ${formatRelativeAge(createdAt)} and served from Cloudflare D1. Latest rollup date: ${latestDay}.`
}

function buildCombinedStatusNote(selections: WorkspaceSelection[]) {
  if (selections.length === 0) {
    return 'No project rollups were found in Cloudflare D1.'
  }

  if (selections.length === 1) {
    const selection = selections[0]
    return buildStatusNote(selection.workspace.provider, selection.latestCreatedAt, selection.latestDay)
  }

  const freshestCreatedAt = Math.max(...selections.map((selection) => selection.latestCreatedAt || 0), 0)
  const latestDay = [...selections.map((selection) => selection.latestDay)].sort().at(-1) || 'n/a'
  return `${selections.length} projects are contributing rollups from Cloudflare D1. Last refresh ${formatRelativeAge(freshestCreatedAt)}. Latest rollup date: ${latestDay}.`
}

function formatRelativeAge(timestamp: number) {
  const deltaMs = Math.max(0, Date.now() - timestamp)
  const deltaMinutes = Math.round(deltaMs / 60000)
  if (deltaMinutes < 1) {
    return 'just now'
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`
  }

  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 48) {
    return `${deltaHours}h ago`
  }

  return `${Math.round(deltaHours / 24)}d ago`
}

function formatUtcDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function formatUtcDayFromSeconds(value: number) {
  return new Date(value * 1000).toISOString().slice(0, 10)
}

function shiftUtcDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return formatUtcDay(date)
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
