import { buildSnapshotFromRollups } from '#/lib/token-analytics'
import type {
  DashboardModelDailyUsage,
  DashboardModelSummary,
  DashboardRepositoryOption,
  DashboardSnapshot,
} from '#/lib/token-analytics'

export function filterSnapshotByRepositories(
  snapshot: DashboardSnapshot,
  selectedRepositoryIds: string[],
): DashboardSnapshot {
  const normalized = normalizeRepositoryIds(
    snapshot.repositories.available,
    selectedRepositoryIds,
  )
  const selectedSet = new Set(normalized)
  const shouldFilter = normalized.length > 0
  const repositoryRows = shouldFilter
    ? snapshot.filters.repositoryRows.filter((row) =>
        selectedSet.has(row.repositoryId),
      )
    : snapshot.filters.repositoryRows
  const repositoryModelRows = shouldFilter
    ? snapshot.filters.repositoryModelRows.filter((row) =>
        selectedSet.has(row.repositoryId),
      )
    : snapshot.filters.repositoryModelRows
  const hourlyRepositoryRows = shouldFilter
    ? snapshot.filters.hourlyRepositoryRows?.filter((row) =>
        selectedSet.has(row.repositoryId),
      )
    : snapshot.filters.hourlyRepositoryRows
  const hourlyRepositoryModelRows = shouldFilter
    ? snapshot.filters.hourlyRepositoryModelRows?.filter((row) =>
        selectedSet.has(row.repositoryId),
      )
    : snapshot.filters.hourlyRepositoryModelRows

  // Repository rows are a reconciled dimension of aggregate usage. Rebuilding
  // from them replaces (rather than adds to) aggregate rows, avoiding double counts.
  const dailyRows =
    snapshot.filters.repositoryRows.length > 0
      ? repositoryRows
      : snapshot.filters.dailyRows
  const modelRows =
    snapshot.filters.repositoryModelRows.length > 0
      ? repositoryModelRows
      : snapshot.filters.modelRowsByDay

  const filtered = buildSnapshotFromRollups({
    availableProjects: snapshot.projects.available,
    availableRepositories: snapshot.repositories.available,
    bucketWindowEnd: snapshot.filters.availableEndDay,
    bucketWindowStart: snapshot.filters.availableStartDay,
    dailyRows,
    environment: snapshot.headline.environment,
    generatedAt: snapshot.headline.generatedAt,
    granularity: snapshot.headline.granularity,
    hourlyModelRowsByDay: hourlyRepositoryModelRows,
    hourlyRows: hourlyRepositoryRows,
    hourlyRepositoryModelRows,
    hourlyRepositoryRows,
    issues: snapshot.issues,
    issuesByDay: snapshot.filters.issuesByDay,
    models: summarizeModels(modelRows),
    modelRowsByDay: modelRows,
    rangeLabel: snapshot.headline.rangeLabel,
    repositoryModelRows,
    repositoryRows,
    selectedProjectIds: snapshot.filters.selectedProjectIds,
    selectedRepositoryIds: normalized,
    sourceLabel: snapshot.headline.sourceLabel,
    statusNote: snapshot.headline.summary,
    workspaceName: snapshot.headline.workspace,
  })
  return {
    ...filtered,
    repositories: {
      ...filtered.repositories,
      attributionCoverage: snapshot.repositories.attributionCoverage,
    },
  }
}

function normalizeRepositoryIds(
  available: DashboardRepositoryOption[],
  selected: string[],
) {
  const availableIds = new Set(
    available.map((repository) => repository.repositoryId),
  )
  return [
    ...new Set(
      selected.filter((repositoryId) => availableIds.has(repositoryId)),
    ),
  ]
}

function summarizeModels(
  rows: DashboardModelDailyUsage[],
): DashboardModelSummary[] {
  const summaries = new Map<string, DashboardModelSummary>()
  for (const row of rows) {
    const key = `${row.provider}:${row.model}`
    const current = summaries.get(key)
    if (current) {
      current.cost += row.cost
      current.requests += row.requests
      current.tokens += row.tokens
    } else {
      summaries.set(key, {
        cost: row.cost,
        model: row.model,
        provider: row.provider,
        requests: row.requests,
        tokens: row.tokens,
      })
    }
  }
  return [...summaries.values()].sort(
    (left, right) =>
      right.tokens - left.tokens || left.model.localeCompare(right.model),
  )
}
