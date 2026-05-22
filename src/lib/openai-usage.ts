import type { CloudflareAppEnv } from '#/lib/runtime'
import type { DashboardSnapshot } from '#/lib/token-analytics'
import { buildFallbackDashboardSnapshot, buildSnapshotFromRollups } from '#/lib/token-analytics'

type DailyRollupRow = {
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
  requests: number
  tokens: number
}

type IssueRow = {
  count: number
  severity: 'high' | 'medium' | 'low'
  title: string
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

type SyncResult = {
  rowsWritten: number
  sourceLabel: string
  syncedAt: string
}

type SnapshotLoadResult = {
  snapshot: DashboardSnapshot
  syncResult?: SyncResult
}

const MODEL_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#db2777', '#ea580c', '#0891b2']
const DEFAULT_DAYS_BACK = 30
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
const OPENAI_PROVIDER = 'OpenAI'

export async function loadDashboardSnapshotForRequest(env: CloudflareAppEnv): Promise<SnapshotLoadResult> {
  const db = env.DB
  const workspace = getWorkspaceConfig(env)
  const latest = await getLatestRollupMeta(db, workspace.id)
  const hasRows = latest !== null

  if (shouldRefresh(latest) && env.OPENAI_API_KEY) {
    try {
      const syncResult = await syncOpenAiUsageToD1(env)
      const snapshot = await loadSnapshotFromD1(env, syncResult.sourceLabel)
      return { snapshot, syncResult }
    } catch (error) {
      if (hasRows) {
        const snapshot = await loadSnapshotFromD1(
          env,
          'Cached OpenAI data, refresh failed',
          `Using the last successful sync. OpenAI refresh failed: ${toErrorMessage(error)}`,
        )
        return { snapshot }
      }

      return {
        snapshot: buildFallbackDashboardSnapshot(
          `OpenAI sync failed before any data was cached. ${toErrorMessage(error)}`,
        ),
      }
    }
  }

  if (hasRows) {
    const snapshot = await loadSnapshotFromD1(
      env,
      env.OPENAI_API_KEY ? 'Cached OpenAI data' : 'Cached OpenAI data, secret missing',
      env.OPENAI_API_KEY
        ? undefined
        : 'Worker is serving cached D1 data because OPENAI_API_KEY is not configured in this runtime.',
    )
    return { snapshot }
  }

  if (!env.OPENAI_API_KEY) {
    return {
      snapshot: buildFallbackDashboardSnapshot(
        'No OpenAI data is cached yet, and OPENAI_API_KEY is not configured in the Worker runtime.',
      ),
    }
  }

  const syncResult = await syncOpenAiUsageToD1(env)
  const snapshot = await loadSnapshotFromD1(env, syncResult.sourceLabel)
  return { snapshot, syncResult }
}

export async function syncOpenAiUsageToD1(env: CloudflareAppEnv): Promise<SyncResult> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing from the Worker runtime.')
  }

  const workspace = getWorkspaceConfig(env)
  const environment = env.OPENAI_USAGE_ENVIRONMENT || env.APP_ENV || 'production'
  const daysBack = getDaysBack(env)
  const now = new Date()
  const startDay = shiftUtcDay(formatUtcDay(now), -(daysBack - 1))
  const startTime = Math.floor(new Date(`${startDay}T00:00:00Z`).getTime() / 1000)

  const [usageResponse, costResponse] = await Promise.all([
    fetchOpenAiUsage(apiKey, startTime, daysBack),
    fetchOpenAiCosts(apiKey, startTime, daysBack),
  ])

  const dayMap = new Map<string, {
    cachedTokens: number
    cost: number
    day: string
    inputTokens: number
    models: Map<string, { requests: number; tokens: number }>
    outputTokens: number
    requests: number
    totalTokens: number
  }>()

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

      const modelEntry = entry.models.get(model) ?? { requests: 0, tokens: 0 }
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

    const modelEntries = [...dayEntry.models.entries()].sort((left, right) => right[1].tokens - left[1].tokens)
    for (const [model, values] of modelEntries) {
      const allocatedCost =
        dayEntry.totalTokens > 0 ? roundCurrency((dayEntry.cost * values.tokens) / dayEntry.totalTokens) : 0
      statements.push(
        env.DB.prepare(
          'INSERT INTO model_daily_usage (id, rollup_id, model, provider, requests, tokens, estimated_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${rollupId}:${model}`,
          rollupId,
          model,
          OPENAI_PROVIDER,
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
  sourceLabel: string,
  statusNote?: string,
): Promise<DashboardSnapshot> {
  const workspace = getWorkspaceConfig(env)
  const rows = await loadDailyRollups(env.DB, workspace.id, getDaysBack(env))

  if (rows.length === 0) {
    return buildFallbackDashboardSnapshot(statusNote || 'No D1 rollups were found for the selected workspace.')
  }

  const firstDay = rows[0].day
  const lastDay = rows[rows.length - 1].day
  const models = await loadModelSummary(env.DB, workspace.id, firstDay, lastDay)
  const issues = await loadIssues(env.DB, workspace.id, firstDay, lastDay)

  return buildSnapshotFromRollups({
    dailyRows: rows,
    generatedAt: new Date(rows[rows.length - 1].createdAt || Date.now()).toISOString(),
    issues,
    models,
    sourceLabel,
    statusNote,
    workspaceName: workspace.name,
    environment: rows[rows.length - 1].environment,
  })
}

async function dbEnsureWorkspace(
  db: D1Database,
  workspace: { id: string; name: string; provider: string; slug: string },
) {
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

async function getLatestRollupMeta(db: D1Database, workspaceId: string) {
  const result = await db
    .prepare(
      `SELECT usage_date as day, created_at as createdAt
       FROM daily_usage_rollups
       WHERE workspace_id = ?
       ORDER BY usage_date DESC
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ createdAt: number; day: string }>()

  return result ?? null
}

async function loadDailyRollups(db: D1Database, workspaceId: string, daysBack: number) {
  const result = await db
    .prepare(
      `SELECT
         usage_date as day,
         environment,
         requests,
         total_tokens as totalTokens,
         input_tokens as inputTokens,
         output_tokens as outputTokens,
         cached_tokens as cachedTokens,
         estimated_cost_usd as cost,
         created_at as createdAt
       FROM daily_usage_rollups
       WHERE workspace_id = ?
       ORDER BY usage_date DESC
       LIMIT ?`,
    )
    .bind(workspaceId, daysBack)
    .all<DailyRollupRow>()

  return [...result.results].reverse()
}

async function loadModelSummary(db: D1Database, workspaceId: string, startDay: string, endDay: string) {
  const result = await db
    .prepare(
      `SELECT
         model_daily_usage.model as model,
         SUM(model_daily_usage.requests) as requests,
         SUM(model_daily_usage.tokens) as tokens,
         SUM(model_daily_usage.estimated_cost_usd) as cost
       FROM model_daily_usage
       INNER JOIN daily_usage_rollups ON daily_usage_rollups.id = model_daily_usage.rollup_id
       WHERE daily_usage_rollups.workspace_id = ?
         AND daily_usage_rollups.usage_date BETWEEN ? AND ?
       GROUP BY model_daily_usage.model
       ORDER BY tokens DESC`,
    )
    .bind(workspaceId, startDay, endDay)
    .all<ModelSummaryRow>()

  return result.results
}

async function loadIssues(db: D1Database, workspaceId: string, startDay: string, endDay: string) {
  const result = await db
    .prepare(
      `SELECT title, count, severity
       FROM issue_events
       WHERE workspace_id = ?
         AND usage_date BETWEEN ? AND ?
       ORDER BY occurred_at DESC`,
    )
    .bind(workspaceId, startDay, endDay)
    .all<IssueRow>()

  return result.results
}

function buildIssueStatements(db: D1Database, workspaceId: string, days: Array<ReturnType<typeof getOrCreateDay>>, nowMs: number) {
  const statements: D1PreparedStatement[] = []

  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1]
    const current = days[index]

    if (previous.cost > 0 && current.cost >= previous.cost * 1.5) {
      statements.push(
        db.prepare(
          'INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          `${workspaceId}:${current.day}:cost-spike`,
          workspaceId,
          nowMs,
          current.day,
          'high',
          `Spend spiked ${Math.round((current.cost / previous.cost) * 100)}% day over day`,
          1,
          JSON.stringify({ currentCost: current.cost, previousCost: previous.cost }),
        ),
      )
    }

    const cacheRate = current.inputTokens > 0 ? current.cachedTokens / current.inputTokens : 0
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

function getWorkspaceConfig(env: CloudflareAppEnv) {
  const slug = slugify(env.OPENAI_USAGE_WORKSPACE_SLUG || env.OPENAI_USAGE_WORKSPACE_NAME || 'openai-organization')
  return {
    id: `workspace:${slug}`,
    name: env.OPENAI_USAGE_WORKSPACE_NAME || 'OpenAI Organization',
    provider: OPENAI_PROVIDER,
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

function getOrCreateDay(
  map: Map<string, {
    cachedTokens: number
    cost: number
    day: string
    inputTokens: number
    models: Map<string, { requests: number; tokens: number }>
    outputTokens: number
    requests: number
    totalTokens: number
  }>,
  day: string,
) {
  const existing = map.get(day)
  if (existing) {
    return existing
  }

  const created = {
    cachedTokens: 0,
    cost: 0,
    day,
    inputTokens: 0,
    models: new Map<string, { requests: number; tokens: number }>(),
    outputTokens: 0,
    requests: 0,
    totalTokens: 0,
  }
  map.set(day, created)
  return created
}

function shouldRefresh(latest: { createdAt: number; day: string } | null) {
  if (!latest) {
    return true
  }

  const createdAt = Number(latest.createdAt || 0)
  if (Date.now() - createdAt > REFRESH_INTERVAL_MS) {
    return true
  }

  const yesterday = shiftUtcDay(formatUtcDay(new Date()), -1)
  return latest.day < yesterday
}

function formatUtcDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatUtcDayFromSeconds(value: number) {
  return new Date(value * 1000).toISOString().slice(0, 10)
}

function shiftUtcDay(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return formatUtcDay(date)
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function decorateModelsWithColors(models: ModelSummaryRow[]) {
  return models.map((model, index) => ({
    ...model,
    color: MODEL_COLORS[index % MODEL_COLORS.length],
  }))
}
