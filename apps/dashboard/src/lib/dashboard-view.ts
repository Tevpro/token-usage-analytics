import { formatHoustonDay, formatHoustonDayShort, formatHoustonTimestamp } from '#/lib/dashboard-timezone'
import type { DashboardSnapshot } from '#/lib/token-analytics'

export const HOME_TABS = ['overview', 'models', 'cost'] as const
export const TABLE_SORT_KEYS = ['day', 'requests', 'totalTokens', 'cost'] as const

export type HomeTab = (typeof HOME_TABS)[number]
export type TableSortKey = (typeof TABLE_SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

export type HomeSearch = {
  page: number
  pageSize: number
  q: string
  sort: TableSortKey
  tab: HomeTab
  dir: SortDirection
}

export type DashboardRow = DashboardSnapshot['table'][number]
export type DashboardModel = DashboardSnapshot['charts']['models'][number]

export const HOME_SEARCH_DEFAULTS: HomeSearch = {
  dir: 'desc',
  page: 1,
  pageSize: 7,
  q: '',
  sort: 'day',
  tab: 'overview',
}

export function formatDay(value: string) {
  return formatHoustonDay(value)
}

export function formatDayShort(value: string) {
  return formatHoustonDayShort(value)
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

export function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

export function formatModelLabel(model: string, provider: string) {
  return provider ? `${provider} · ${model}` : model
}

export function toPolylinePoints(values: number[]) {
  const maxValue = Math.max(...values, 1)

  return values
    .map((value, index) => {
      const x = 16 + index * (288 / Math.max(values.length - 1, 1))
      const y = 130 - (value / maxValue) * 112
      return `${x},${y}`
    })
    .join(' ')
}

export function getProjectFilterSummary({
  availableProjects,
  selectedProjectIds,
}: {
  availableProjects: DashboardSnapshot['projects']['available']
  selectedProjectIds: string[]
}) {
  const total = availableProjects.length
  const selected = selectedProjectIds.length === 0 ? availableProjects : availableProjects.filter((project) => selectedProjectIds.includes(project.projectId))
  const selectedCount = selected.length

  if (selectedCount === 0) {
    return {
      countLabel: '0 selected',
      label: 'Agents',
    }
  }

  if (selectedCount === total) {
    return {
      countLabel: `${selectedCount}/${total}`,
      label: total === 1 ? selected[0]?.projectName || 'Agent' : 'All agents',
    }
  }

  if (selectedCount === 1) {
    return {
      countLabel: '1 selected',
      label: selected[0]?.projectName || 'Selected agent',
    }
  }

  return {
    countLabel: `${selectedCount}/${total}`,
    label: `${selectedCount} agents`,
  }
}

export function toggleProjectSelection({
  availableProjects,
  projectId,
  selectedProjectIds,
}: {
  availableProjects: DashboardSnapshot['projects']['available']
  projectId: string
  selectedProjectIds: string[]
}) {
  const allProjectIds = availableProjects.map((project) => project.projectId)
  const current = selectedProjectIds.length === 0 ? allProjectIds : [...new Set(selectedProjectIds)]

  if (current.includes(projectId)) {
    const next = current.filter((candidate) => candidate !== projectId)
    return next.length === allProjectIds.length ? [] : next
  }

  const next = [...current, projectId]
  return next.length === allProjectIds.length ? [] : next
}

export { formatHoustonTimestamp }

export function parseHomeSearch(search: Record<string, unknown>): HomeSearch {
  const tab = asTab(search.tab)
  const sort = asSortKey(search.sort)
  const dir = asDirection(search.dir)
  const q = typeof search.q === 'string' ? search.q.trim() : ''
  const page = clampInteger(search.page, 1)
  const pageSize = clampInteger(search.pageSize, 7, [5, 7, 10, 14, 20])

  return { ...HOME_SEARCH_DEFAULTS, dir, page, pageSize, q, sort, tab }
}

export function buildHomeView(snapshot: DashboardSnapshot, search: HomeSearch) {
  const query = normalize(search.q)
  const filteredTable = snapshot.table
    .filter((row) => matchesRow(row, query))
    .sort((left, right) => compareRows(left, right, search.sort, search.dir))

  const pageCount = Math.max(1, Math.ceil(filteredTable.length / search.pageSize))
  const page = Math.min(search.page, pageCount)
  const start = (page - 1) * search.pageSize
  const pagedTable = filteredTable.slice(start, start + search.pageSize)

  const filteredModels = snapshot.charts.models.filter((model) => matchesModel(model, query))
  const filteredIssues = snapshot.issues.filter((issue) => matchesIssue(issue, query))
  const filteredCallouts = snapshot.callouts.filter((callout) => matchesText(callout, query))
  const filteredKpis = snapshot.kpis.filter((kpi) => matchesText(`${kpi.label} ${kpi.value}`, query))

  return {
    filteredCallouts,
    filteredIssues,
    filteredKpis,
    filteredModels,
    filteredTable,
    page,
    pageCount,
    pagedTable,
    query,
    resultLabel: filteredTable.length === 1 ? '1 matching day' : `${filteredTable.length} matching days`,
  }
}

export function getDayDetail(snapshot: DashboardSnapshot, day: string) {
  const rows = [...snapshot.table].sort((left, right) => left.day.localeCompare(right.day))
  const index = rows.findIndex((row) => row.day === day)
  if (index === -1) return null

  const row = rows[index]
  const previous = index > 0 ? rows[index - 1] : null
  const next = index < rows.length - 1 ? rows[index + 1] : null

  return {
    day,
    next,
    previous,
    row,
    shareOfPeriodCost: ratio(row.cost, rows.reduce((sum, item) => sum + item.cost, 0)),
    shareOfPeriodRequests: ratio(row.requests, rows.reduce((sum, item) => sum + item.requests, 0)),
    shareOfPeriodTokens: ratio(row.totalTokens, rows.reduce((sum, item) => sum + item.totalTokens, 0)),
  }
}

export function getModelDetail(snapshot: DashboardSnapshot, modelName: string) {
  const models = [...snapshot.charts.models].sort((left, right) => right.tokens - left.tokens)
  const selected = models.find((model) => model.model === modelName)
  if (!selected) return null

  const totalRequests = models.reduce((sum, item) => sum + item.requests, 0)
  const totalTokens = models.reduce((sum, item) => sum + item.tokens, 0)
  const totalCost = models.reduce((sum, item) => sum + item.cost, 0)

  return {
    peers: models,
    rank: models.findIndex((model) => model.model === modelName) + 1,
    selected,
    shareOfCost: ratio(selected.cost, totalCost),
    shareOfRequests: ratio(selected.requests, totalRequests),
    shareOfTokens: ratio(selected.tokens, totalTokens),
  }
}

export function toggleSortDirection(search: HomeSearch, sort: TableSortKey) {
  if (search.sort !== sort) {
    return { dir: defaultDirectionForSort(sort) as SortDirection, sort }
  }

  return {
    dir: search.dir === 'asc' ? 'desc' : 'asc',
    sort,
  }
}

function compareRows(left: DashboardRow, right: DashboardRow, sort: TableSortKey, dir: SortDirection) {
  const direction = dir === 'asc' ? 1 : -1

  if (sort === 'day') return left.day.localeCompare(right.day) * direction
  if (sort === 'requests') return (left.requests - right.requests) * direction
  if (sort === 'cost') return (left.cost - right.cost) * direction
  return (left.totalTokens - right.totalTokens) * direction
}

function matchesRow(row: DashboardRow, query: string) {
  if (!query) return true
  return matchesText(`${row.day} ${row.traceId}`, query)
}

function matchesModel(model: DashboardModel, query: string) {
  if (!query) return true
  return matchesText(`${model.model} ${model.provider}`, query)
}

function matchesIssue(issue: DashboardSnapshot['issues'][number], query: string) {
  if (!query) return true
  return matchesText(`${issue.title} ${issue.severity}`, query)
}

function matchesText(value: string, query: string) {
  if (!query) return true
  return normalize(value).includes(query)
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function asTab(value: unknown): HomeTab {
  return typeof value === 'string' && (HOME_TABS as readonly string[]).includes(value) ? (value as HomeTab) : 'overview'
}

function asSortKey(value: unknown): TableSortKey {
  return typeof value === 'string' && (TABLE_SORT_KEYS as readonly string[]).includes(value)
    ? (value as TableSortKey)
    : 'day'
}

function asDirection(value: unknown): SortDirection {
  return value === 'asc' || value === 'desc' ? value : 'desc'
}

function clampInteger(value: unknown, fallback: number, allowed?: number[]) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  const rounded = Math.trunc(parsed)
  if (allowed && !allowed.includes(rounded)) return fallback
  return rounded
}

function ratio(value: number, total: number) {
  if (total <= 0) return 0
  return value / total
}

function defaultDirectionForSort(sort: TableSortKey) {
  return sort === 'day' ? 'desc' : 'desc'
}
