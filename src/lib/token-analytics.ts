type SnapshotBuildInput = {
  dailyRows: Array<{
    cachedTokens: number
    cost: number
    day: string
    inputTokens: number
    outputTokens: number
    requests: number
    totalTokens: number
  }>
  environment: string
  generatedAt: string
  issues: Array<{
    count: number
    severity: 'high' | 'medium' | 'low'
    title: string
  }>
  models: Array<{
    cost: number
    model: string
    requests: number
    tokens: number
  }>
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

  const cacheRate = totals.inputTokens > 0 ? totals.cachedTokens / totals.inputTokens : 0
  const modelRows = input.models.map((model, index) => ({
    ...model,
    color: MODEL_COLORS[index % MODEL_COLORS.length],
    provider: 'OpenAI',
  }))
  const topModel = modelRows.at(0)
  const topDay = [...input.dailyRows].sort((left, right) => right.cost - left.cost).at(0)

  return {
    headline: {
      environment: input.environment,
      generatedAt: input.generatedAt,
      rangeLabel: `Last ${input.dailyRows.length} days`,
      sourceLabel: input.sourceLabel,
      summary:
        input.statusNote ||
        'Daily OpenAI organization usage rolled into Cloudflare D1 for fast dashboard queries on Workers.',
      workspace: input.workspaceName,
    },
    kpis: [
      {
        label: 'Total Tokens',
        tone: 'neutral',
        value: formatCompactNumber(totals.totalTokens),
      },
      {
        label: 'Actual Cost',
        tone: totals.cost > 0 ? 'warning' : 'neutral',
        value: `$${totals.cost.toFixed(2)}`,
      },
      {
        label: 'Requests',
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
        primary: row.inputTokens,
        secondary: row.outputTokens,
      })),
      models: modelRows,
      requestsCostCache: input.dailyRows.map((row) => ({
        day: row.day,
        primary: row.requests,
        secondary: Math.round(row.cost * 10),
        tertiary: row.inputTokens > 0 ? Math.round((row.cachedTokens / row.inputTokens) * 100) : 0,
      })),
      tokenVolume: input.dailyRows.map((row) => ({
        day: row.day,
        inputTokens: row.inputTokens,
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
              title: 'No anomalies detected in the current OpenAI window.',
            },
          ],
    table: input.dailyRows.map((row) => ({
      cachedShare: row.inputTokens > 0 ? row.cachedTokens / row.inputTokens : 0,
      cost: row.cost,
      day: row.day,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      requests: row.requests,
      totalTokens: row.totalTokens,
      traceId: row.day.replaceAll('-', '').slice(2),
    })),
    callouts: [
      topModel
        ? `${topModel.model} drove the most volume with ${formatCompactNumber(topModel.tokens)} tokens across the selected window.`
        : 'No model-level usage returned from OpenAI for this window.',
      topDay
        ? `${formatDay(topDay.day)} was the highest-cost day at $${topDay.cost.toFixed(2)}.`
        : 'No daily cost data returned from OpenAI for this window.',
      `Source label: ${input.sourceLabel}.`,
    ],
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
      workspace: 'OpenAI Organization',
    },
    kpis: [
      { label: 'Total Tokens', tone: 'neutral', value: '0' },
      { label: 'Actual Cost', tone: 'neutral', value: '$0.00' },
      { label: 'Requests', tone: 'neutral', value: '0' },
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
        { color: MODEL_COLORS[0], cost: 0, model: 'gpt-4.1', provider: 'OpenAI', requests: 0, tokens: 0 },
        { color: MODEL_COLORS[1], cost: 0, model: 'gpt-4o-mini', provider: 'OpenAI', requests: 0, tokens: 0 },
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
        title: 'Set OPENAI_API_KEY in Cloudflare Workers, then run a sync to replace sample data.',
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
      'This fallback keeps the UI legible while real credentials are wired.',
      'Once OPENAI_API_KEY exists in the Worker runtime, the dashboard can sync OpenAI organization usage into D1.',
      'Real OpenAI usage data does not include everything from the original mock, so the dashboard now emphasizes requests, tokens, cache share, models, and cost.',
    ],
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

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
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
  headline: {
    environment: string
    generatedAt: string
    rangeLabel: string
    sourceLabel: string
    summary: string
    workspace: string
  }
  issues: Array<{
    count: number
    severity: 'high' | 'medium' | 'low'
    title: string
  }>
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
