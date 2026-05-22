type DailyPointSeed = {
  day: string
  requests: number
  tokens: number
  cost: number
  errors: number
  avgLatencyMs: number
  p95LatencyMs: number
  inputTokens: number
  outputTokens: number
  cacheHitRate: number
}

const dailySeed: DailyPointSeed[] = [
  { day: '2026-05-01', requests: 84, tokens: 162400, cost: 18.92, errors: 1, avgLatencyMs: 1320, p95LatencyMs: 2620, inputTokens: 113100, outputTokens: 49300, cacheHitRate: 0.28 },
  { day: '2026-05-02', requests: 93, tokens: 171800, cost: 20.11, errors: 2, avgLatencyMs: 1280, p95LatencyMs: 2480, inputTokens: 118900, outputTokens: 52900, cacheHitRate: 0.3 },
  { day: '2026-05-03', requests: 88, tokens: 156900, cost: 18.14, errors: 1, avgLatencyMs: 1360, p95LatencyMs: 2750, inputTokens: 107600, outputTokens: 49300, cacheHitRate: 0.27 },
  { day: '2026-05-04', requests: 104, tokens: 194300, cost: 23.62, errors: 2, avgLatencyMs: 1390, p95LatencyMs: 2810, inputTokens: 131900, outputTokens: 62400, cacheHitRate: 0.31 },
  { day: '2026-05-05', requests: 111, tokens: 208500, cost: 25.17, errors: 3, avgLatencyMs: 1430, p95LatencyMs: 2890, inputTokens: 142300, outputTokens: 66200, cacheHitRate: 0.29 },
  { day: '2026-05-06', requests: 119, tokens: 227900, cost: 27.91, errors: 4, avgLatencyMs: 1520, p95LatencyMs: 3140, inputTokens: 154500, outputTokens: 73400, cacheHitRate: 0.26 },
  { day: '2026-05-07', requests: 126, tokens: 241100, cost: 30.44, errors: 4, avgLatencyMs: 1490, p95LatencyMs: 3010, inputTokens: 164700, outputTokens: 76400, cacheHitRate: 0.32 },
  { day: '2026-05-08', requests: 121, tokens: 232600, cost: 29.88, errors: 3, avgLatencyMs: 1470, p95LatencyMs: 2960, inputTokens: 157300, outputTokens: 75300, cacheHitRate: 0.34 },
  { day: '2026-05-09', requests: 132, tokens: 258400, cost: 32.65, errors: 5, avgLatencyMs: 1580, p95LatencyMs: 3290, inputTokens: 174100, outputTokens: 84300, cacheHitRate: 0.25 },
  { day: '2026-05-10', requests: 144, tokens: 281300, cost: 35.42, errors: 4, avgLatencyMs: 1610, p95LatencyMs: 3340, inputTokens: 189700, outputTokens: 91600, cacheHitRate: 0.27 },
  { day: '2026-05-11', requests: 138, tokens: 268100, cost: 33.74, errors: 3, avgLatencyMs: 1530, p95LatencyMs: 3120, inputTokens: 182000, outputTokens: 86100, cacheHitRate: 0.35 },
  { day: '2026-05-12', requests: 147, tokens: 294600, cost: 36.98, errors: 6, avgLatencyMs: 1660, p95LatencyMs: 3410, inputTokens: 197200, outputTokens: 97400, cacheHitRate: 0.24 },
  { day: '2026-05-13', requests: 154, tokens: 309400, cost: 39.08, errors: 5, avgLatencyMs: 1680, p95LatencyMs: 3480, inputTokens: 208400, outputTokens: 101000, cacheHitRate: 0.22 },
  { day: '2026-05-14', requests: 162, tokens: 326800, cost: 41.62, errors: 7, avgLatencyMs: 1710, p95LatencyMs: 3570, inputTokens: 220900, outputTokens: 105900, cacheHitRate: 0.23 } ,
]

const modelBreakdown = [
  { model: 'gpt-4.1', provider: 'OpenAI', requests: 568, tokens: 1389000, cost: 178.61, color: '#3b82f6' },
  { model: 'gpt-4o-mini', provider: 'OpenAI', requests: 742, tokens: 1674000, cost: 92.14, color: '#8b5cf6' },
  { model: 'claude-sonnet-4', provider: 'Anthropic', requests: 201, tokens: 834000, cost: 109.42, color: '#14b8a6' },
  { model: 'gemini-2.5-pro', provider: 'Google', requests: 117, tokens: 509000, cost: 58.33, color: '#ec4899' },
]

const toolBreakdown = [
  { tool: 'github', calls: 412, errorRate: 0.02 },
  { tool: 'browser', calls: 301, errorRate: 0.03 },
  { tool: 'search', calls: 228, errorRate: 0.01 },
  { tool: 'terminal', calls: 188, errorRate: 0.04 },
  { tool: 'slack', calls: 92, errorRate: 0.01 },
]

const issueFeed = [
  { title: 'Spend spike on gpt-4.1 after prompt regression', count: 12, severity: 'high' },
  { title: 'Tool retries inflated browser token usage', count: 9, severity: 'medium' },
  { title: 'Cache hit rate dropped below 25% for support agents', count: 7, severity: 'medium' },
  { title: 'Two malformed traces missing model labels', count: 3, severity: 'low' },
  { title: 'Daily import lag exceeded 10 minutes once', count: 1, severity: 'low' },
] as const

export function buildDashboardSnapshot(): DashboardSnapshot {
  const totals = dailySeed.reduce(
    (accumulator, point) => {
      accumulator.requests += point.requests
      accumulator.tokens += point.tokens
      accumulator.cost += point.cost
      accumulator.errors += point.errors
      accumulator.inputTokens += point.inputTokens
      accumulator.outputTokens += point.outputTokens
      return accumulator
    },
    { requests: 0, tokens: 0, cost: 0, errors: 0, inputTokens: 0, outputTokens: 0 },
  )

  const topDay = [...dailySeed].sort((left, right) => right.tokens - left.tokens)[0]
  const latestDay = dailySeed[dailySeed.length - 1]
  const previousDay = dailySeed[dailySeed.length - 2]

  return {
    headline: {
      workspace: 'Tevpro AI Ops',
      environment: 'Production',
      rangeLabel: 'Last 14 days',
      generatedAt: '2026-05-22T16:42:00Z',
      summary:
        'Daily token visibility across agents, models, tools, and anomaly events. Built for Cloudflare Workers with a D1-backed rollup model.',
    },
    kpis: [
      {
        label: 'Total Tokens',
        value: formatCompactNumber(totals.tokens),
        deltaLabel: '+14.2% vs prior window',
        tone: 'positive',
      },
      {
        label: 'Estimated Cost',
        value: `$${totals.cost.toFixed(2)}`,
        deltaLabel: '+9.1% vs prior window',
        tone: 'warning',
      },
      {
        label: 'Requests',
        value: totals.requests.toLocaleString('en-US'),
        deltaLabel: `${latestDay.requests - previousDay.requests >= 0 ? '+' : ''}${latestDay.requests - previousDay.requests} day/day`,
        tone: 'neutral',
      },
      {
        label: 'Error Rate',
        value: `${((totals.errors / totals.requests) * 100).toFixed(2)}%`,
        deltaLabel: 'Stable under 3%',
        tone: 'positive',
      },
    ],
    charts: {
      traffic: dailySeed.map((point) => ({
        day: point.day,
        primary: point.requests,
        secondary: point.errors,
        tertiary: Math.round(point.cacheHitRate * 100),
      })),
      latency: dailySeed.map((point) => ({
        day: point.day,
        primary: point.avgLatencyMs,
        secondary: point.p95LatencyMs,
      })),
      llmCalls: modelBreakdown,
      tokensUsed: dailySeed.map((point) => ({
        day: point.day,
        inputTokens: point.inputTokens,
        outputTokens: point.outputTokens,
      })),
      toolCalls: toolBreakdown,
    },
    issues: issueFeed.map((issue) => ({ ...issue })),
    table: dailySeed.map((point) => ({
      traceId: point.day.replaceAll('-', '').slice(2),
      day: point.day,
      requests: point.requests,
      totalTokens: point.tokens,
      cost: point.cost,
      avgLatencyMs: point.avgLatencyMs,
      errors: point.errors,
    })),
    callouts: [
      `Peak consumption landed on ${topDay.day} with ${formatCompactNumber(topDay.tokens)} tokens.`,
      'The intended v1 data shape is one rollup row per workspace, model, tool, and day to keep dashboard queries cheap on Workers.',
      'Cache hit rate is visible because it is usually the fastest lever for shaving cost without touching product behavior.',
    ],
  }
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export type DashboardSnapshot = {
  headline: {
    workspace: string
    environment: string
    rangeLabel: string
    generatedAt: string
    summary: string
  }
  kpis: Array<{
    label: string
    value: string
    deltaLabel: string
    tone: 'positive' | 'warning' | 'neutral'
  }>
  charts: {
    traffic: Array<{
      day: string
      primary: number
      secondary: number
      tertiary: number
    }>
    latency: Array<{
      day: string
      primary: number
      secondary: number
    }>
    llmCalls: Array<{
      model: string
      provider: string
      requests: number
      tokens: number
      cost: number
      color: string
    }>
    tokensUsed: Array<{
      day: string
      inputTokens: number
      outputTokens: number
    }>
    toolCalls: Array<{
      tool: string
      calls: number
      errorRate: number
    }>
  }
  issues: Array<{
    title: string
    count: number
    severity: 'high' | 'medium' | 'low'
  }>
  table: Array<{
    traceId: string
    day: string
    requests: number
    totalTokens: number
    cost: number
    avgLatencyMs: number
    errors: number
  }>
  callouts: string[]
}
