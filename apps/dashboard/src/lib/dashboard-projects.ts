import { buildSnapshotFromRollups } from '#/lib/token-analytics'
import type {
  DashboardIssueByDay,
  DashboardModelDailyUsage,
  DashboardModelSummary,
  DashboardProjectOption,
  DashboardSnapshot,
} from '#/lib/token-analytics'

export function filterSnapshotByProjects(snapshot: DashboardSnapshot, selectedProjectIds: string[]): DashboardSnapshot {
  const filteredProjectIds = normalizeSelectedProjectIds(snapshot.projects.available, selectedProjectIds)
  const selectedSet = new Set(filteredProjectIds)
  const shouldFilter = filteredProjectIds.length > 0 && filteredProjectIds.length < snapshot.projects.available.length

  const dailyRows = shouldFilter
    ? snapshot.filters.dailyRows.filter((row) => selectedSet.has(row.projectId))
    : snapshot.filters.dailyRows
  const issuesByDay = shouldFilter
    ? snapshot.filters.issuesByDay.filter((issue) => selectedSet.has(issue.projectId))
    : snapshot.filters.issuesByDay
  const modelRowsByDay = shouldFilter
    ? snapshot.filters.modelRowsByDay.filter((row) => selectedSet.has(row.projectId))
    : snapshot.filters.modelRowsByDay
  const hourlyRows = shouldFilter
    ? snapshot.filters.hourlyRows?.filter((row) => selectedSet.has(row.projectId))
    : snapshot.filters.hourlyRows
  const hourlyModelRowsByDay = shouldFilter
    ? snapshot.filters.hourlyModelRowsByDay?.filter((row) => selectedSet.has(row.projectId))
    : snapshot.filters.hourlyModelRowsByDay

  return buildSnapshotFromRollups({
    availableProjects: snapshot.projects.available,
    bucketWindowEnd: snapshot.filters.availableEndDay,
    bucketWindowStart: snapshot.filters.availableStartDay,
    dailyRows,
    environment: snapshot.headline.environment,
    generatedAt: snapshot.headline.generatedAt,
    granularity: snapshot.headline.granularity,
    hourlyModelRowsByDay,
    hourlyRows,
    issues: summarizeIssues(issuesByDay),
    issuesByDay,
    models: summarizeModels(modelRowsByDay),
    modelRowsByDay,
    rangeLabel: snapshot.headline.rangeLabel,
    selectedProjectIds: filteredProjectIds,
    sourceLabel: snapshot.headline.sourceLabel,
    pricingStatus: snapshot.headline.pricing,
    statusNote: snapshot.headline.summary,
    workspaceName: summarizeProjectSelection(snapshot.projects.available, filteredProjectIds),
  })
}

function normalizeSelectedProjectIds(availableProjects: DashboardProjectOption[], selectedProjectIds: string[]) {
  const availableSet = new Set(availableProjects.map((project) => project.projectId))
  return [...new Set(selectedProjectIds.filter((projectId) => availableSet.has(projectId)))]
}

function summarizeProjectSelection(availableProjects: DashboardProjectOption[], selectedProjectIds: string[]) {
  if (selectedProjectIds.length === 0 || selectedProjectIds.length === availableProjects.length) {
    return availableProjects.length === 1 ? availableProjects[0]?.projectName || 'Agent' : 'All agents'
  }

  if (selectedProjectIds.length === 1) {
    return availableProjects.find((project) => project.projectId === selectedProjectIds[0])?.projectName || 'Selected agent'
  }

  return `${selectedProjectIds.length} selected agents`
}

function summarizeModels(modelRows: DashboardModelDailyUsage[]): DashboardModelSummary[] {
  const modelMap = new Map<string, DashboardModelSummary>()

  for (const row of modelRows) {
    const key = `${row.provider}:${row.model}`
    const current = modelMap.get(key)
    if (current) {
      current.cost += row.cost
      current.projectedCost = (current.projectedCost || 0) + (row.projectedCost || 0)
      current.requests += row.requests
      current.tokens += row.tokens
      continue
    }

    modelMap.set(key, {
      cost: row.cost,
      model: row.model,
      projectedCost: row.projectedCost || 0,
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
