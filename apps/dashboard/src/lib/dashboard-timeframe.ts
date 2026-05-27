import { buildSnapshotFromRollups } from '#/lib/token-analytics'
import type {
  DashboardIssueByDay,
  DashboardModelDailyUsage,
  DashboardModelSummary,
  DashboardSnapshot,
} from '#/lib/token-analytics'

export type TimeframePreset = '24h' | '7d' | '30d' | '90d' | 'custom'

export type TimeframeSelection = {
  endDay?: string
  preset: TimeframePreset
  startDay?: string
}

type ResolvedTimeframe = {
  endDay: string
  preset: TimeframePreset
  rangeLabel: string
  startDay: string
}

const PRESET_DAY_COUNTS: Record<Exclude<TimeframePreset, 'custom'>, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export function filterSnapshotByTimeframe(snapshot: DashboardSnapshot, selection: TimeframeSelection): DashboardSnapshot {
  const resolved = resolveTimeframeSelection(snapshot, selection)
  const filteredDailyRows = snapshot.filters.dailyRows.filter((row) => row.day >= resolved.startDay && row.day <= resolved.endDay)
  const filteredIssueRows = snapshot.filters.issuesByDay.filter(
    (issue) => issue.day >= resolved.startDay && issue.day <= resolved.endDay,
  )
  const filteredModelRows = snapshot.filters.modelRowsByDay.filter(
    (row) => row.day >= resolved.startDay && row.day <= resolved.endDay,
  )

  return buildSnapshotFromRollups({
    availableProjects: snapshot.filters.availableProjects,
    dailyRows: filteredDailyRows,
    environment: snapshot.headline.environment,
    generatedAt: snapshot.headline.generatedAt,
    issues: summarizeIssues(filteredIssueRows),
    issuesByDay: filteredIssueRows,
    models: summarizeModels(filteredModelRows),
    modelRowsByDay: filteredModelRows,
    rangeLabel: resolved.rangeLabel,
    selectedProjectIds: snapshot.filters.selectedProjectIds,
    sourceLabel: snapshot.headline.sourceLabel,
    statusNote: snapshot.headline.summary,
    workspaceName: snapshot.headline.workspace,
  })
}

export function resolveTimeframeSelection(snapshot: DashboardSnapshot, selection: TimeframeSelection): ResolvedTimeframe {
  const availableStartDay = snapshot.filters.availableStartDay
  const availableEndDay = snapshot.filters.availableEndDay

  if (selection.preset === 'custom') {
    const requestedStart = selection.startDay || availableStartDay
    const requestedEnd = selection.endDay || availableEndDay
    const [orderedStart, orderedEnd] = requestedStart <= requestedEnd ? [requestedStart, requestedEnd] : [requestedEnd, requestedStart]
    const startDay = clampDay(orderedStart, availableStartDay, availableEndDay)
    const endDay = clampDay(orderedEnd, availableStartDay, availableEndDay)

    return {
      endDay,
      preset: selection.preset,
      rangeLabel: `${formatDay(startDay)} to ${formatDay(endDay)}`,
      startDay,
    }
  }

  const dayCount = PRESET_DAY_COUNTS[selection.preset]
  const endDay = clampDay(selection.endDay || availableEndDay, availableStartDay, availableEndDay)
  const startDay = maxDay(addDays(endDay, -(dayCount - 1)), availableStartDay)

  return {
    endDay,
    preset: selection.preset,
    rangeLabel: getPresetLabel(selection.preset),
    startDay,
  }
}

function summarizeModels(modelRows: DashboardModelDailyUsage[]): DashboardModelSummary[] {
  const modelMap = new Map<string, DashboardModelSummary>()

  for (const row of modelRows) {
    const key = `${row.provider}:${row.model}`
    const current = modelMap.get(key)
    if (current) {
      current.cost += row.cost
      current.requests += row.requests
      current.tokens += row.tokens
      continue
    }

    modelMap.set(key, {
      cost: row.cost,
      model: row.model,
      provider: row.provider,
      requests: row.requests,
      tokens: row.tokens,
    })
  }

  return [...modelMap.values()].sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model))
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

function getPresetLabel(preset: Exclude<TimeframePreset, 'custom'>) {
  switch (preset) {
    case '24h':
      return 'Last 24 hours'
    case '7d':
      return 'Last 7 days'
    case '30d':
      return 'Last 30 days'
    case '90d':
      return 'Last 90 days'
  }
}

function clampDay(value: string, minimum: string, maximum: string) {
  if (value < minimum) {
    return minimum
  }

  if (value > maximum) {
    return maximum
  }

  return value
}

function maxDay(left: string, right: string) {
  return left > right ? left : right
}

function addDays(day: string, days: number) {
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`))
}
