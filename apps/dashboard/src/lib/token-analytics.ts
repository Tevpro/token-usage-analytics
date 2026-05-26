export type DashboardDailyRow = {
  cachedTokens: number
  cost: number
  day: string
  inputTokens: number
  outputTokens: number
  requests: number
  totalTokens: number
}

export type DashboardIssue = {
  count: number
  severity: 'high' | 'medium' | 'low'
  title: string
}

export type DashboardIssueByDay = DashboardIssue & {
  day: string
}

export type DashboardModelSummary = {
  cost: number
  model: string
  provider?: string
  requests: number
  tokens: number
}

export type DashboardModelDailyUsage = {
  cost: number
  day: string
  model: string
  provider: string
  requests: number
  tokens: number
}

type SnapshotBuildInput = {
  dailyRows: DashboardDailyRow[]
  environment: string
  generatedAt: string
  issues: DashboardIssue[]
  issuesByDay?: DashboardIssueByDay[]
  models: DashboardModelSummary[]
  modelRowsByDay?: DashboardModelDailyUsage[]
  rangeLabel?: string
  sourceLabel: string
  statusNote?: string
  workspaceName: string
}

const MODEL_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#db2777', '#ea580c', '#0891b2']

export function buildSnapshotFromRollups(input: SnapshotBuildInput): DashboardSnapshot {
  const totals = input.dailyRows.reduce(
    (accumulator, row) => {
      accumulator.cachedTokens += row.cachedTokens
      accumulator.cost += row.cost
      accumulator.inputTokens += row.inputTokens
      accumulator.outputTokens += row.outputTokens
      accumulator.requests += row.requests
      accumulator.totalTokens += row.totalTokens
      return accumulator
    },
    {
      cachedTokens: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      totalTokens: 0,
    },
  )

  const totalInputTokens = input.dailyRows.reduce((sum, row) => sum + resolveTotalInputTokens(row), 0)
  const cacheRate = totalInputTokens > 0 ? Math.min(1, totals.cachedTokens / totalInputTokens) : 0
  const modelRows = input.models.map((model, index) => ({
    ...model,
    color: MODEL_COLORS[index % MODEL_COLORS.length],
    provider: model.provider || 'Unknown',
  }))
  const topModel = modelRows.at(0)
  const topDayByTokens = [...input.dailyRows].sort((left, right) => right.totalTokens - left.totalTokens).at(0)
  const topDayByCost = [...input.dailyRows].sort((left, right) => right.cost - left.cost).at(0)
  const availableStartDay = input.dailyRows[0]?.day || ''
  const availableEndDay = input.dailyRows.at(-1)?.day || ''

  return {
    headline: {
      environment: input.environment,
      generatedAt: input.generatedAt,
      rangeLabel: input.rangeLabel || `Last ${input.dailyRows.length} days`,
      sourceLabel: input.sourceLabel,
      summary:
        input.statusNote ||
        'Usage rollups are cached in Cloudflare D1 so the dashboard can read quickly on Workers without reaching back into the source system.',
      workspace: input.workspaceName,
    },
    kpis: [
      {
        label: 'Total Tokens',
        tone: 'neutral',
        value: formatCompactNumber(totals.totalTokens),
      },
      {
        label: 'Tracked Cost',
        tone: totals.cost > 0 ? 'warning' : 'neutral',
        value: `$${totals.cost.toFixed(2)}`,
      },
      {
        label: 'API Calls',
        tone: 'neutral',
        value: totals.requests.toLocaleString('en-US'),
      },
      {
        label: 'Cached Input Share',
        tone: cacheRate >= 0.2 ? 'positive' : cacheRate >= 0.05 ? 'warning' : 'negative',
        value: `${(cacheRate * 100).toFixed(1)}%`,
      },
    ],
    charts: {
      costByDay: input.dailyRows.map((row) => ({
        cost: row.cost,
        day: row.day,
      })),
      inputOutput: input.dailyRows.map((row) => ({
        day: row.day,
        primary: resolveTotalInputTokens(row),
        secondary: row.outputTokens,
      })),
      models: modelRows,
      requestsCostCache: input.dailyRows.map((row) => ({
        day: row.day,
        primary: row.requests,
        secondary: Math.round(row.cost * 10),
        tertiary: Math.round(calculateCachedShare(row) * 100),
      })),
      tokenVolume: input.dailyRows.map((row) => ({
        day: row.day,
        inputTokens: resolveTotalInputTokens(row),
        outputTokens: row.outputTokens,
      })),
    },
    issues:
      input.issues.length > 0
        ? input.issues
        : [
            {
              count: 0,
              severity: 'low',
              title: 'No anomalies detected in the current reporting window.',
            },
          ],
    table: input.dailyRows.map((row) => ({
      cachedShare: calculateCachedShare(row),
      cost: row.cost,
      day: row.day,
      inputTokens: resolveTotalInputTokens(row),
      outputTokens: row.outputTokens,
      requests: row.requests,
      totalTokens: row.totalTokens,
      traceId: row.day.replaceAll('-', '').slice(2),
    })),
    callouts: [
      topModel
        ? `${topModel.model} drove the most volume with ${formatCompactNumber(topModel.tokens)} tokens across the selected window.`
        : 'No model-level usage was returned for this window.',
      topDayByTokens
        ? `${formatDay(topDayByTokens.day)} was the busiest day at ${formatCompactNumber(topDayByTokens.totalTokens)} total tokens.`
        : 'No daily token data was returned for this window.',
      topDayByCost && topDayByCost.cost > 0
        ? `${formatDay(topDayByCost.day)} carried the highest tracked cost at $${topDayByCost.cost.toFixed(2)}.`
        : `Source label: ${input.sourceLabel}.`,
    ],
    filters: {
      availableEndDay,
      availableStartDay,
      dailyRows: input.dailyRows,
      issuesByDay: input.issuesByDay || input.issues.map((issue) => ({ ...issue, day: availableEndDay })),
      modelRowsByDay:
        input.modelRowsByDay ||
        input.models.map((model) => ({
          cost: model.cost,
          day: availableEndDay,
          model: model.model,
          provider: model.provider || 'Unknown',
          requests: model.requests,
          tokens: model.tokens,
        })),
    },
  }
}

export function buildFallbackDashboardSnapshot(reason: string): DashboardSnapshot {
  return {
    headline: {
      environment: 'Configuration required',
      generatedAt: new Date().toISOString(),
      rangeLabel: 'Last 14 days',
      sourceLabel: 'Fallback sample data',
      summary: reason,
      workspace: 'Token Usage Workspace',
    },
    kpis: [
      { label: 'Total Tokens', tone: 'neutral', value: '0' },
      { label: 'Tracked Cost', tone: 'neutral', value: '$0.00' },
      { label: 'API Calls', tone: 'neutral', value: '0' },
      { label: 'Cached Input Share', tone: 'warning', value: '0.0%' },
    ],
    charts: {
      costByDay: fallbackDays.map((day, index) => ({
        cost: Number((1.8 + index * 0.35).toFixed(2)),
        day,
      })),
      inputOutput: fallbackDays.map((day, index) => ({
        day,
        primary: 90000 + index * 8000,
        secondary: 28000 + index * 3500,
      })),
      models: [
        { color: MODEL_COLORS[0], cost: 0, model: 'gpt-5.4', provider: 'Hermes', requests: 0, tokens: 0 },
        { color: MODEL_COLORS[1], cost: 0, model: 'claude-sonnet', provider: 'Hermes', requests: 0, tokens: 0 },
      ],
      requestsCostCache: fallbackDays.map((day, index) => ({
        day,
        primary: 24 + index * 3,
        secondary: 18 + index,
        tertiary: 12 + index * 2,
      })),
      tokenVolume: fallbackDays.map((day, index) => ({
        day,
        inputTokens: 90000 + index * 8000,
        outputTokens: 28000 + index * 3500,
      })),
    },
    issues: [
      {
        count: 1,
        severity: 'medium',
        title: 'Wire a real ingestion source, then let the Worker read D1 instead of sample data.',
      },
    ],
    table: fallbackDays.map((day, index) => ({
      cachedShare: 0.08 + index * 0.01,
      cost: Number((1.8 + index * 0.35).toFixed(2)),
      day,
      inputTokens: 90000 + index * 8000,
      outputTokens: 28000 + index * 3500,
      requests: 24 + index * 3,
      totalTokens: 118000 + index * 11500,
      traceId: day.replaceAll('-', '').slice(2),
    })),
    callouts: [
      'This fallback keeps the UI legible while the live ingestion path is being wired.',
      'Once the Worker starts receiving rollups, the dashboard will read D1 instead of sample data.',
      'The dashboard emphasizes tokens, requests, cache share, models, and tracked cost over decorative metrics.',
    ],
    filters: {
      availableEndDay: fallbackDays.at(-1) || '',
      availableStartDay: fallbackDays[0] || '',
      dailyRows: fallbackDays.map((day, index) => ({
        cachedTokens: Math.round((90000 + index * 8000) * (0.08 + index * 0.01)),
        cost: Number((1.8 + index * 0.35).toFixed(2)),
        day,
        inputTokens: 90000 + index * 8000,
        outputTokens: 28000 + index * 3500,
        requests: 24 + index * 3,
        totalTokens: 118000 + index * 11500,
      })),
      issuesByDay: [
        {
          count: 1,
          day: fallbackDays.at(-1) || '',
          severity: 'medium',
          title: 'Wire a real ingestion source, then let the Worker read D1 instead of sample data.',
        },
      ],
      modelRowsByDay: fallbackDays.flatMap((day, index) => [
        {
          cost: 0,
          day,
          model: 'gpt-5.4',
          provider: 'Hermes',
          requests: 18 + index * 2,
          tokens: 74000 + index * 6200,
        },
        {
          cost: 0,
          day,
          model: 'claude-sonnet',
          provider: 'Hermes',
          requests: 6 + index,
          tokens: 44000 + index * 5300,
        },
      ]),
    },
  }
}

const fallbackDays = [
  '2026-05-09',
  '2026-05-10',
  '2026-05-11',
  '2026-05-12',
  '2026-05-13',
  '2026-05-14',
  '2026-05-15',
]

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

export function resolveTotalInputTokens(row: Pick<DashboardDailyRow, 'inputTokens' | 'outputTokens' | 'totalTokens'>) {
  return Math.max(row.inputTokens, row.totalTokens - row.outputTokens, 0)
}

export function calculateCachedShare(
  row: Pick<DashboardDailyRow, 'cachedTokens' | 'inputTokens' | 'outputTokens' | 'totalTokens'>,
) {
  const totalInputTokens = resolveTotalInputTokens(row)
  if (totalInputTokens <= 0 || row.cachedTokens <= 0) {
    return 0
  }

  return Math.min(1, row.cachedTokens / totalInputTokens)
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`))
}

export type DashboardSnapshot = {
  callouts: string[]
  charts: {
    costByDay: Array<{
      cost: number
      day: string
    }>
    inputOutput: Array<{
      day: string
      primary: number
      secondary: number
    }>
    models: Array<{
      color: string
      cost: number
      model: string
      provider: string
      requests: number
      tokens: number
    }>
    requestsCostCache: Array<{
      day: string
      primary: number
      secondary: number
      tertiary: number
    }>
    tokenVolume: Array<{
      day: string
      inputTokens: number
      outputTokens: number
    }>
  }
  filters: {
    availableEndDay: string
    availableStartDay: string
    dailyRows: DashboardDailyRow[]
    issuesByDay: DashboardIssueByDay[]
    modelRowsByDay: DashboardModelDailyUsage[]
  }
  headline: {
    environment: string
    generatedAt: string
    rangeLabel: string
    sourceLabel: string
    summary: string
    workspace: string
  }
  issues: DashboardIssue[]
  kpis: Array<{
    label: string
    tone: 'positive' | 'warning' | 'neutral' | 'negative'
    value: string
  }>
  table: Array<{
    cachedShare: number
    cost: number
    day: string
    inputTokens: number
    outputTokens: number
    requests: number
    totalTokens: number
    traceId: string
  }>
}
