export type DashboardProjectOption = {
  projectId: string
  projectName: string
  projectProvider: string
  projectSlug: string
}

export type DashboardProjectSummary = DashboardProjectOption & {
  cachedShare: number
  cachedTokens: number
  cost: number
  inputTokens: number
  outputTokens: number
  requests: number
  totalTokens: number
}

export type DashboardDailyRow = DashboardProjectOption & {
  cachedTokens: number
  cost: number
  day: string
  hasData?: boolean
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

export type DashboardIssueByDay = DashboardIssue &
  DashboardProjectOption & {
    day: string
  }

export type DashboardModelSummary = {
  cost: number
  model: string
  provider?: string
  requests: number
  tokens: number
}

export type DashboardModelDailyUsage = DashboardProjectOption & {
  cost: number
  day: string
  model: string
  provider: string
  requests: number
  tokens: number
}

type SnapshotBuildInput = {
  availableProjects?: DashboardProjectOption[]
  bucketWindowEnd?: string
  bucketWindowStart?: string
  dailyRows: DashboardDailyRow[]
  environment: string
  generatedAt: string
  granularity?: DashboardBucketGranularity
  hourlyModelRowsByDay?: DashboardModelDailyUsage[]
  hourlyRows?: DashboardDailyRow[]
  issues: DashboardIssue[]
  issuesByDay?: DashboardIssueByDay[]
  models: DashboardModelSummary[]
  modelRowsByDay?: DashboardModelDailyUsage[]
  rangeLabel?: string
  selectedProjectIds?: string[]
  sourceLabel: string
  statusNote?: string
  workspaceName?: string
}

export type DashboardBucketGranularity = 'day' | 'hour'

const MODEL_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#db2777', '#ea580c', '#0891b2']

export function buildSnapshotFromRollups(input: SnapshotBuildInput): DashboardSnapshot {
  const granularity = input.granularity || 'day'
  const aggregatedDailyRows =
    granularity === 'hour'
      ? fillMissingHourlyBuckets(summarizeRowsByBucket(input.dailyRows), input.generatedAt)
      : fillMissingDailyBuckets(
          summarizeRowsByBucket(input.dailyRows),
          input.bucketWindowStart,
          input.bucketWindowEnd,
        )
  const totals = aggregatedDailyRows.reduce(
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

  const totalInputTokens = aggregatedDailyRows.reduce((sum, row) => sum + resolveTotalInputTokens(row), 0)
  const cacheRate = totalInputTokens > 0 ? Math.min(1, totals.cachedTokens / totalInputTokens) : 0
  const modelRows = input.models.map((model, index) => ({
    ...model,
    color: MODEL_COLORS[index % MODEL_COLORS.length],
    provider: model.provider || 'Unknown',
  }))
  const topModel = modelRows.at(0)
  const topDayByTokens = [...aggregatedDailyRows].sort((left, right) => right.totalTokens - left.totalTokens).at(0)
  const topDayByCost = [...aggregatedDailyRows].sort((left, right) => right.cost - left.cost).at(0)
  const bucketLabel = granularity === 'hour' ? 'hour' : 'day'
  const availableStartDay = aggregatedDailyRows[0]?.day || ''
  const availableEndDay = aggregatedDailyRows.at(-1)?.day || ''
  const availableProjects = resolveAvailableProjects(input.availableProjects, input.dailyRows)
  const resolvedSelectedProjectIds = resolveSelectedProjectIds(availableProjects, input.selectedProjectIds)
  const projectBreakdown = summarizeProjects(input.dailyRows, availableProjects, resolvedSelectedProjectIds)
  const workspaceLabel = input.workspaceName || summarizeProjectSelection(availableProjects, resolvedSelectedProjectIds)

  return {
    callouts: [
      topModel
        ? `${topModel.model} drove the most volume with ${formatCompactNumber(topModel.tokens)} tokens across the selected window.`
        : 'No model-level usage was returned for this window.',
      topDayByTokens
        ? `${formatDay(topDayByTokens.day)} was the busiest ${bucketLabel} at ${formatCompactNumber(topDayByTokens.totalTokens)} total tokens.`
        : `No ${bucketLabel}-level token data was returned for this window.`,
      projectBreakdown.length > 1
        ? `${projectBreakdown[0].projectName} led the selected project set with ${formatCompactNumber(projectBreakdown[0].totalTokens)} tokens.`
        : topDayByCost && topDayByCost.cost > 0
          ? `${formatDay(topDayByCost.day)} carried the highest tracked cost for any ${bucketLabel} at $${topDayByCost.cost.toFixed(2)}.`
          : `Source label: ${input.sourceLabel}.`,
    ],
    charts: {
      costByDay: aggregatedDailyRows.map((row) => ({
        cost: row.cost,
        day: row.day,
        missing: row.hasData === false,
      })),
      inputOutput: aggregatedDailyRows.map((row) => ({
        day: row.day,
        missing: row.hasData === false,
        primary: resolveTotalInputTokens(row),
        secondary: row.outputTokens,
      })),
      models: modelRows,
      requestsCostCache: aggregatedDailyRows.map((row) => ({
        day: row.day,
        missing: row.hasData === false,
        primary: row.requests,
        secondary: Math.round(row.cost * 10),
        tertiary: Math.round(calculateCachedShare(row) * 100),
      })),
      tokenVolume: aggregatedDailyRows.map((row) => ({
        day: row.day,
        inputTokens: resolveTotalInputTokens(row),
        missing: row.hasData === false,
        outputTokens: row.outputTokens,
      })),
    },
    filters: {
      availableEndDay,
      availableProjects,
      availableStartDay,
      dailyRows: input.dailyRows,
      hourlyModelRowsByDay: input.hourlyModelRowsByDay,
      hourlyRows: input.hourlyRows,
      issuesByDay: input.issuesByDay || input.issues.map((issue) => ({ ...issue, ...EMPTY_PROJECT, day: availableEndDay })),
      modelRowsByDay:
        input.modelRowsByDay ||
        input.models.map((model) => ({
          ...EMPTY_PROJECT,
          cost: model.cost,
          day: availableEndDay,
          model: model.model,
          provider: model.provider || 'Unknown',
          requests: model.requests,
          tokens: model.tokens,
        })),
      selectedProjectIds: resolvedSelectedProjectIds,
    },
    headline: {
      environment: input.environment,
      generatedAt: input.generatedAt,
      granularity,
      rangeLabel: input.rangeLabel || `Last ${aggregatedDailyRows.length} ${granularity === 'hour' ? 'hours' : 'days'}`,
      sourceLabel: input.sourceLabel,
      summary:
        input.statusNote ||
        'Usage rollups are cached in Cloudflare D1 so the dashboard can read quickly on Workers without reaching back into the source system.',
      workspace: workspaceLabel,
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
    projects: {
      available: availableProjects,
      breakdown: projectBreakdown,
      selected: resolvedSelectedProjectIds,
    },
    table: aggregatedDailyRows.map((row) => ({
      cachedShare: calculateCachedShare(row),
      cost: row.cost,
      day: row.day,
      hasData: row.hasData !== false,
      inputTokens: resolveTotalInputTokens(row),
      outputTokens: row.outputTokens,
      requests: row.requests,
      totalTokens: row.totalTokens,
      traceId: normalizeTraceId(row.day),
    })),
  }
}

export function buildFallbackDashboardSnapshot(reason: string): DashboardSnapshot {
  const availableProjects = [
    {
      projectId: 'project:fallback-sample',
      projectName: 'Fallback sample',
      projectProvider: 'Hermes',
      projectSlug: 'fallback-sample',
    },
  ] satisfies DashboardProjectOption[]

  return {
    callouts: [
      'This fallback keeps the UI legible while the live ingestion path is being wired.',
      'Once the Worker starts receiving rollups, the dashboard will read D1 instead of sample data.',
      'The dashboard emphasizes tokens, requests, cache share, models, and tracked cost over decorative metrics.',
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
    filters: {
      availableEndDay: fallbackDays.at(-1) || '',
      availableProjects,
      availableStartDay: fallbackDays[0] || '',
      dailyRows: fallbackDays.map((day, index) => ({
        cachedTokens: Math.round((90000 + index * 8000) * (0.08 + index * 0.01)),
        cost: Number((1.8 + index * 0.35).toFixed(2)),
        day,
        inputTokens: 90000 + index * 8000,
        outputTokens: 28000 + index * 3500,
        projectId: 'project:fallback-sample',
        projectName: 'Fallback sample',
        projectProvider: 'Hermes',
        projectSlug: 'fallback-sample',
        requests: 24 + index * 3,
        totalTokens: 118000 + index * 11500,
      })),
      issuesByDay: [
        {
          count: 1,
          day: fallbackDays.at(-1) || '',
          projectId: 'project:fallback-sample',
          projectName: 'Fallback sample',
          projectProvider: 'Hermes',
          projectSlug: 'fallback-sample',
          severity: 'medium',
          title: 'Wire a real ingestion source, then let the Worker read D1 instead of sample data.',
        },
      ],
      modelRowsByDay: fallbackDays.flatMap((day, index) => [
        {
          cost: 0,
          day,
          model: 'gpt-5.4',
          projectId: 'project:fallback-sample',
          projectName: 'Fallback sample',
          projectProvider: 'Hermes',
          projectSlug: 'fallback-sample',
          provider: 'Hermes',
          requests: 18 + index * 2,
          tokens: 74000 + index * 6200,
        },
        {
          cost: 0,
          day,
          model: 'claude-sonnet',
          projectId: 'project:fallback-sample',
          projectName: 'Fallback sample',
          projectProvider: 'Hermes',
          projectSlug: 'fallback-sample',
          provider: 'Hermes',
          requests: 6 + index,
          tokens: 44000 + index * 5300,
        },
      ]),
      selectedProjectIds: ['project:fallback-sample'],
    },
    headline: {
      environment: 'Configuration required',
      generatedAt: new Date().toISOString(),
      granularity: 'day',
      rangeLabel: 'Last 14 days',
      sourceLabel: 'Fallback sample data',
      summary: reason,
      workspace: 'Fallback sample',
    },
    issues: [
      {
        count: 1,
        severity: 'medium',
        title: 'Wire a real ingestion source, then let the Worker read D1 instead of sample data.',
      },
    ],
    kpis: [
      { label: 'Total Tokens', tone: 'neutral', value: '0' },
      { label: 'Tracked Cost', tone: 'neutral', value: '$0.00' },
      { label: 'API Calls', tone: 'neutral', value: '0' },
      { label: 'Cached Input Share', tone: 'warning', value: '0.0%' },
    ],
    projects: {
      available: availableProjects,
      breakdown: [
        {
          cachedShare: 0,
          cachedTokens: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          projectId: 'project:fallback-sample',
          projectName: 'Fallback sample',
          projectProvider: 'Hermes',
          projectSlug: 'fallback-sample',
          requests: 0,
          totalTokens: 0,
        },
      ],
      selected: ['project:fallback-sample'],
    },
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
  }
}

const fallbackDays = ['2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']

const EMPTY_PROJECT: DashboardProjectOption = {
  projectId: 'project:unknown',
  projectName: 'Unknown project',
  projectProvider: 'Unknown',
  projectSlug: 'unknown-project',
}

function summarizeRowsByBucket(rows: DashboardDailyRow[]) {
  const dayMap = new Map<string, DashboardDailyRow>()

  for (const row of rows) {
    const current = dayMap.get(row.day)
    if (current) {
      current.cachedTokens += row.cachedTokens
      current.cost += row.cost
      current.inputTokens += row.inputTokens
      current.outputTokens += row.outputTokens
      current.requests += row.requests
      current.totalTokens += row.totalTokens
      current.hasData = current.hasData !== false || row.hasData !== false
      continue
    }

    dayMap.set(row.day, {
      ...EMPTY_PROJECT,
      cachedTokens: row.cachedTokens,
      cost: row.cost,
      day: row.day,
      hasData: row.hasData !== false,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      requests: row.requests,
      totalTokens: row.totalTokens,
    })
  }

  return [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day))
}

function fillMissingDailyBuckets(rows: DashboardDailyRow[], windowStart?: string, windowEnd?: string) {
  if (rows.length === 0) {
    return rows
  }

  const sortedRows = [...rows].sort((left, right) => left.day.localeCompare(right.day))
  const startDay = windowStart || sortedRows[0]?.day
  const endDay = windowEnd || sortedRows.at(-1)?.day

  if (!startDay || !endDay || startDay > endDay) {
    return sortedRows
  }

  const rowMap = new Map(sortedRows.map((row) => [row.day, row]))
  const filledRows: DashboardDailyRow[] = []

  for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
    const existing = rowMap.get(day)
    if (existing) {
      filledRows.push(existing)
      continue
    }

    filledRows.push({
      ...EMPTY_PROJECT,
      cachedTokens: 0,
      cost: 0,
      day,
      hasData: false,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      totalTokens: 0,
    })
  }

  return filledRows
}

function addDays(day: string, days: number) {
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function fillMissingHourlyBuckets(rows: DashboardDailyRow[], generatedAt?: string) {
  if (rows.length === 0) {
    return rows
  }

  const sortedRows = [...rows].sort((left, right) => left.day.localeCompare(right.day))
  const latestRowTimestamp = Date.parse(sortedRows.at(-1)?.day || '')
  if (Number.isNaN(latestRowTimestamp)) {
    return sortedRows
  }

  const generatedAtTimestamp = Date.parse(generatedAt || '')
  const anchorTimestamp =
    Number.isFinite(generatedAtTimestamp) && generatedAtTimestamp > latestRowTimestamp
      ? truncateToHour(generatedAtTimestamp)
      : latestRowTimestamp

  const rowMap = new Map(sortedRows.map((row) => [row.day, row]))
  const filledRows: DashboardDailyRow[] = []

  for (let offset = 23; offset >= 0; offset -= 1) {
    const timestamp = anchorTimestamp - offset * 60 * 60 * 1000
    const day = new Date(timestamp).toISOString().slice(0, 13) + ':00:00Z'
    const existing = rowMap.get(day)
    if (existing) {
      filledRows.push(existing)
      continue
    }

    filledRows.push({
      ...EMPTY_PROJECT,
      cachedTokens: 0,
      cost: 0,
      day,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      totalTokens: 0,
    })
  }

  return filledRows
}

function truncateToHour(timestampMs: number) {
  const date = new Date(timestampMs)
  date.setUTCMinutes(0, 0, 0)
  return date.getTime()
}

function resolveAvailableProjects(availableProjects: DashboardProjectOption[] | undefined, dailyRows: DashboardDailyRow[]) {
  if (availableProjects && availableProjects.length > 0) {
    return [...availableProjects].sort((left, right) => left.projectName.localeCompare(right.projectName))
  }

  const projectMap = new Map<string, DashboardProjectOption>()
  for (const row of dailyRows) {
    if (!projectMap.has(row.projectId)) {
      projectMap.set(row.projectId, {
        projectId: row.projectId,
        projectName: row.projectName,
        projectProvider: row.projectProvider,
        projectSlug: row.projectSlug,
      })
    }
  }

  return [...projectMap.values()].sort((left, right) => left.projectName.localeCompare(right.projectName))
}

function resolveSelectedProjectIds(availableProjects: DashboardProjectOption[], selectedProjectIds?: string[]) {
  const availableSet = new Set(availableProjects.map((project) => project.projectId))
  const filtered = (selectedProjectIds || []).filter((projectId) => availableSet.has(projectId))
  return filtered.length > 0 ? [...new Set(filtered)] : availableProjects.map((project) => project.projectId)
}

function summarizeProjectSelection(availableProjects: DashboardProjectOption[], selectedProjectIds: string[]) {
  if (availableProjects.length === 0) {
    return 'Projects'
  }

  if (selectedProjectIds.length === availableProjects.length) {
    return availableProjects.length === 1 ? availableProjects[0]?.projectName || 'Project' : 'All projects'
  }

  if (selectedProjectIds.length === 1) {
    return availableProjects.find((project) => project.projectId === selectedProjectIds[0])?.projectName || 'Selected project'
  }

  return `${selectedProjectIds.length} selected projects`
}

function summarizeProjects(
  rows: DashboardDailyRow[],
  availableProjects: DashboardProjectOption[],
  selectedProjectIds: string[],
): DashboardProjectSummary[] {
  const selectedProjectSet = new Set(selectedProjectIds)
  const projectMap = new Map<string, DashboardProjectSummary>()

  for (const project of availableProjects) {
    if (!selectedProjectSet.has(project.projectId)) {
      continue
    }

    projectMap.set(project.projectId, {
      cachedShare: 0,
      cachedTokens: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      projectId: project.projectId,
      projectName: project.projectName,
      projectProvider: project.projectProvider,
      projectSlug: project.projectSlug,
      requests: 0,
      totalTokens: 0,
    })
  }

  for (const row of rows) {
    if (!selectedProjectSet.has(row.projectId)) {
      continue
    }

    const current = projectMap.get(row.projectId)
    if (!current) {
      continue
    }

    current.cachedTokens += row.cachedTokens
    current.cost += row.cost
    current.inputTokens += row.inputTokens
    current.outputTokens += row.outputTokens
    current.requests += row.requests
    current.totalTokens += row.totalTokens
  }

  return [...projectMap.values()]
    .map((project) => ({
      ...project,
      cachedShare: calculateCachedShare(project),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.projectName.localeCompare(right.projectName))
}

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
  const isTimestamp = value.includes('T')
  const date = isTimestamp ? new Date(value) : new Date(`${value}T00:00:00Z`)

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: isTimestamp ? 'numeric' : undefined,
    minute: isTimestamp ? '2-digit' : undefined,
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date)
}

function normalizeTraceId(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, '').slice(-12) || 'window'
}

export type DashboardSnapshot = {
  callouts: string[]
  charts: {
    costByDay: Array<{
      cost: number
      day: string
      missing?: boolean
    }>
    inputOutput: Array<{
      day: string
      missing?: boolean
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
      missing?: boolean
      primary: number
      secondary: number
      tertiary: number
    }>
    tokenVolume: Array<{
      day: string
      inputTokens: number
      missing?: boolean
      outputTokens: number
    }>
  }
  filters: {
    availableEndDay: string
    availableProjects: DashboardProjectOption[]
    availableStartDay: string
    dailyRows: DashboardDailyRow[]
    hourlyModelRowsByDay?: DashboardModelDailyUsage[]
    hourlyRows?: DashboardDailyRow[]
    issuesByDay: DashboardIssueByDay[]
    modelRowsByDay: DashboardModelDailyUsage[]
    selectedProjectIds: string[]
  }
  headline: {
    environment: string
    generatedAt: string
    granularity: DashboardBucketGranularity
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
  projects: {
    available: DashboardProjectOption[]
    breakdown: DashboardProjectSummary[]
    selected: string[]
  }
  table: Array<{
    cachedShare: number
    cost: number
    day: string
    hasData?: boolean
    inputTokens: number
    outputTokens: number
    requests: number
    totalTokens: number
    traceId: string
  }>
}
