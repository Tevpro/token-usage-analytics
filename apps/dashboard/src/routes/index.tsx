import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarRange,
  RefreshCcw,
  Search,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { getAgentDataStatus } from '#/lib/dashboard-agent-status'
import { filterSnapshotByProjects } from '#/lib/dashboard-projects'
import { filterSnapshotByTimeframe } from '#/lib/dashboard-timeframe'
import type { TimeframePreset, TimeframeSelection } from '#/lib/dashboard-timeframe'
import { loadDashboardSnapshotForRequest } from '#/lib/openai-usage'
import type { DashboardProjectSummary, DashboardSnapshot } from '#/lib/token-analytics'

const getDashboardSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRuntimeEnv } = await import('#/lib/worker-env')
  const result = await loadDashboardSnapshotForRequest(getRuntimeEnv())
  return result.snapshot
})

export const Route = createFileRoute('/')({
  loader: async () => getDashboardSnapshot(),
  component: Home,
})

function Home() {
  const snapshot = Route.useLoaderData()
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [timeframe, setTimeframe] = useState<TimeframeSelection>(() => getInitialTimeframeSelection(snapshot))
  const projectSnapshot = useMemo(() => filterSnapshotByProjects(snapshot, selectedProjectIds), [selectedProjectIds, snapshot])
  const activeSnapshot = useMemo(() => filterSnapshotByTimeframe(projectSnapshot, timeframe), [projectSnapshot, timeframe])
  const agentDataStatus = useMemo(
    () => getAgentDataStatus(activeSnapshot.headline.generatedAt),
    [activeSnapshot.headline.generatedAt],
  )
  const bucketLabel = activeSnapshot.headline.granularity === 'hour' ? 'Hourly' : 'Daily'
  const bucketColumnLabel = activeSnapshot.headline.granularity === 'hour' ? 'Time' : 'Day'
  const costChartTitle = activeSnapshot.headline.granularity === 'hour' ? 'Allocated hourly cost' : 'Allocated daily cost'

  return (
    <main className="dashboard-shell">
      <section className="dashboard-header">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="dashboard-kicker">Token observability</p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="dashboard-title">Token usage</h1>
                <p className="max-w-3xl text-sm text-slate-600">{activeSnapshot.headline.summary}</p>
              </div>
              <div className="dashboard-header-actions">
                <Badge
                  aria-label={`${activeSnapshot.headline.sourceLabel}. ${agentDataStatus.detail}`}
                  className={`dashboard-status-badge dashboard-status-${agentDataStatus.level}`}
                  title={agentDataStatus.detail}
                  variant="secondary"
                >
                  <span aria-hidden className="dashboard-status-dot" />
                  {activeSnapshot.headline.sourceLabel}
                </Badge>
                <Button className="dashboard-feedback-button" onClick={() => window.location.reload()} variant="outline">
                  <RefreshCcw className="size-4" />
                  Refresh view
                </Button>
              </div>
            </div>
          </div>

          <Tabs
            className="w-full"
            onValueChange={(value) => setActiveTab(value as DashboardTab)}
            value={activeTab}
          >
            <TabsList className="dashboard-tabs-list">
              <TabsTrigger className="dashboard-tab-trigger" value="overview">Overview</TabsTrigger>
              <TabsTrigger className="dashboard-tab-trigger" value="models">Models</TabsTrigger>
              <TabsTrigger className="dashboard-tab-trigger" value="cost">Cost</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      <section className="dashboard-toolbar">
        <div className="toolbar-chip-group">
          <ProjectFilterChip
            availableProjects={snapshot.projects.available}
            onChange={setSelectedProjectIds}
            selectedProjectIds={selectedProjectIds}
          />
          <div className="toolbar-chip gap-3">
            <CalendarRange className="size-4" />
            <Select
              onValueChange={(value) => {
                const preset = value as TimeframePreset
                setTimeframe((current) => ({
                  endDay: current.endDay || projectSnapshot.filters.availableEndDay,
                  preset,
                  startDay: current.startDay || projectSnapshot.filters.availableStartDay,
                }))
              }}
              value={timeframe.preset}
            >
              <SelectTrigger className="h-8 w-[148px] border-0 bg-transparent px-0 text-left text-sm font-medium text-slate-700 shadow-none focus:ring-0">
                <SelectValue aria-label="Timeframe" placeholder="Select window" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {timeframe.preset === 'custom' ? (
            <div className="toolbar-chip toolbar-chip-wide gap-2 pr-3">
              <Input
                aria-label="Start date"
                className="h-8 w-[132px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                max={timeframe.endDay || projectSnapshot.filters.availableEndDay}
                min={projectSnapshot.filters.availableStartDay}
                onChange={(event) => setTimeframe((current) => ({ ...current, startDay: event.target.value }))}
                type="date"
                value={timeframe.startDay || projectSnapshot.filters.availableStartDay}
              />
              <span className="text-slate-400">→</span>
              <Input
                aria-label="End date"
                className="h-8 w-[132px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                max={projectSnapshot.filters.availableEndDay}
                min={timeframe.startDay || projectSnapshot.filters.availableStartDay}
                onChange={(event) => setTimeframe((current) => ({ ...current, endDay: event.target.value }))}
                type="date"
                value={timeframe.endDay || projectSnapshot.filters.availableEndDay}
              />
            </div>
          ) : null}
        </div>

        <label className="toolbar-search">
          <Search className="size-4 text-slate-400" />
          <Input
            aria-label="Search spans, users, tags, and more"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            defaultValue=""
            placeholder="Search, filter, and extend from here"
          />
        </label>
      </section>

      <section className="kpi-grid">
        {activeSnapshot.kpis.map((kpi) => (
          <Card key={kpi.label} className="kpi-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-slate-950">{kpi.value}</div>
              <p className={`mt-2 text-sm ${toneClassNameMap[kpi.tone]}`}>{activeSnapshot.headline.sourceLabel}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {activeTab === 'overview' ? (
        <>
          <section className="analytics-grid analytics-grid-top">
            <ChartCard
              legend={[
                { label: 'Requests', color: 'var(--chart-grey)' },
                { label: 'Cost ×10', color: 'var(--chart-red)' },
                { label: 'Cached %', color: 'var(--chart-violet)' },
              ]}
              title="Requests / Cost / Cache"
            >
              <TrafficBars data={activeSnapshot.charts.requestsCostCache} />
            </ChartCard>

            <ChartCard
              legend={[
                { label: 'Input tokens', color: 'var(--chart-violet)' },
                { label: 'Output tokens', color: 'var(--chart-ink)' },
              ]}
              title="Input vs output"
            >
              <LineChart data={activeSnapshot.charts.inputOutput} title="Input and output tokens" />
            </ChartCard>

            <Card className="panel-card panel-card-signals">
              <CardHeader className="panel-header-row">
                <div>
                  <CardTitle className="panel-title">Signals</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="issue-list">
                  {activeSnapshot.issues.map((issue) => (
                    <div className="issue-row" key={`${issue.severity}:${issue.title}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge className="issue-badge" variant="secondary">
                          {issue.severity}
                        </Badge>
                        <span className="truncate text-sm text-indigo-700">{issue.title}</span>
                      </div>
                      <span className="text-sm font-medium text-slate-600">{issue.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="callout-strip">
            {activeSnapshot.callouts.map((callout) => (
              <article className="callout-card" key={callout}>
                <ArrowUpRight className="mt-0.5 size-4 text-indigo-600" />
                <p>{callout}</p>
              </article>
            ))}
          </section>

          <ProjectBreakdownCard projects={activeSnapshot.projects.breakdown} />

          <Card className="panel-card overflow-hidden daily-rollups-card">
            <CardHeader className="panel-header-row">
              <div>
                <CardTitle className="panel-title">{bucketLabel} rollups</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {activeSnapshot.headline.granularity === 'hour'
                    ? 'Hourly buckets expose the last 24 hours of request, token, cache, and allocated cost activity for faster troubleshooting.'
                    : 'Daily rollups cached in D1 for fast reads on Workers, regardless of whether the source is Hermes, OpenAI, or another provider.'}
                </p>
              </div>
              <Badge className="daily-rollups-badge rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600" variant="secondary">
                <Activity className="mr-1 size-3.5" />
                {activeSnapshot.headline.generatedAt.slice(0, 16).replace('T', ' ')} refresh basis
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="daily-rollups-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">Trace ID</TableHead>
                    <TableHead>{bucketColumnLabel}</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Total Tokens</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Input</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Output</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Cached %</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSnapshot.table.map((row) => (
                    <TableRow key={row.traceId}>
                      <TableCell className="hidden font-medium text-indigo-700 sm:table-cell">{row.traceId}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{formatBucketLabel(row.day)}</span>
                          <span className="text-xs text-slate-500 sm:hidden">{row.traceId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{row.requests.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-right">{formatCompact(row.totalTokens)}</TableCell>
                      <TableCell className="hidden text-right lg:table-cell">{formatCompact(row.inputTokens)}</TableCell>
                      <TableCell className="hidden text-right lg:table-cell">{formatCompact(row.outputTokens)}</TableCell>
                      <TableCell className="hidden text-right md:table-cell">{(row.cachedShare * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right">${row.cost.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'models' ? (
        <div className="space-y-6">
          <ModelUsageBreakdownCard models={activeSnapshot.charts.models} />

          <section className="analytics-grid analytics-grid-bottom">
            <ChartCard
              footer={
                <LegendStats
                  items={activeSnapshot.charts.models.map((item) => ({
                    accent: item.color,
                    key: `${item.provider}:${item.model}:requests`,
                    label: formatModelLabel(item.model, item.provider),
                    value: item.requests.toLocaleString('en-US'),
                  }))}
                />
              }
              title="Model requests"
            >
              <ModelBars data={activeSnapshot.charts.models} valueKey="requests" />
            </ChartCard>

            <ChartCard
              footer={
                <LegendStats
                  items={activeSnapshot.charts.models.map((item) => ({
                    accent: item.color,
                    key: `${item.provider}:${item.model}:tokens`,
                    label: formatModelLabel(item.model, item.provider),
                    value: formatCompact(item.tokens),
                  }))}
                />
              }
              title="Token volume"
            >
              <TokenBars data={activeSnapshot.charts.tokenVolume} />
            </ChartCard>

            <ChartCard
              footer={
                <LegendStats
                  items={activeSnapshot.charts.models.map((item) => ({
                    accent: item.color,
                    key: `${item.provider}:${item.model}:cost`,
                    label: formatModelLabel(item.model, item.provider),
                    value: formatCurrency(item.cost),
                  }))}
                />
              }
              title={costChartTitle}
            >
              <CostBars data={activeSnapshot.charts.costByDay} />
            </ChartCard>
          </section>
        </div>
      ) : null}

      {activeTab === 'cost' ? (
        <>
          <section className="analytics-grid analytics-grid-top">
            <ChartCard
              legend={[
                { label: 'Requests', color: 'var(--chart-grey)' },
                { label: 'Cost ×10', color: 'var(--chart-red)' },
                { label: 'Cached %', color: 'var(--chart-violet)' },
              ]}
              title="Requests / Cost / Cache"
            >
              <TrafficBars data={activeSnapshot.charts.requestsCostCache} />
            </ChartCard>

            <ChartCard
              legend={[
                { label: 'Input tokens', color: 'var(--chart-violet)' },
                { label: 'Output tokens', color: 'var(--chart-ink)' },
              ]}
              title="Input vs output"
            >
              <LineChart data={activeSnapshot.charts.inputOutput} title="Input and output tokens" />
            </ChartCard>

            <ChartCard title={costChartTitle}>
              <CostBars data={activeSnapshot.charts.costByDay} />
            </ChartCard>
          </section>

          <ProjectBreakdownCard projects={activeSnapshot.projects.breakdown} />

          <Card className="panel-card overflow-hidden daily-rollups-card">
            <CardHeader className="panel-header-row">
              <div>
                <CardTitle className="panel-title">{bucketLabel} rollups</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Review the request, token, cache, and cost totals behind the current cost window.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="daily-rollups-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">Trace ID</TableHead>
                    <TableHead>{bucketColumnLabel}</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Total Tokens</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Cached %</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSnapshot.table.map((row) => (
                    <TableRow key={`${row.traceId}:cost`}>
                      <TableCell className="hidden font-medium text-indigo-700 sm:table-cell">{row.traceId}</TableCell>
                      <TableCell>{formatBucketLabel(row.day)}</TableCell>
                      <TableCell className="text-right">{row.requests.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-right">{formatCompact(row.totalTokens)}</TableCell>
                      <TableCell className="hidden text-right md:table-cell">{(row.cachedShare * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </main>
  )
}

function ModelUsageBreakdownCard({ models }: ModelUsageBreakdownCardProps) {
  if (models.length <= 1) {
    return null
  }

  const totalTokens = models.reduce((sum, item) => sum + item.tokens, 0)

  return (
    <Card className="panel-card">
      <CardHeader className="panel-header-row">
        <div>
          <CardTitle className="panel-title">Model usage breakdown</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            More than one model was active in this window, so this view breaks usage down by token share.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {models.map((item) => {
            const share = totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0

            return (
              <span
                className="h-full"
                key={`${item.provider}:${item.model}:share-bar`}
                style={{ backgroundColor: item.color, width: `${Math.max(share, 3)}%` }}
              />
            )
          })}
        </div>

        <div className="legend-stats">
          {models.map((item) => {
            const share = totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0

            return (
              <div className="legend-stat-row" key={`${item.provider}:${item.model}:share-row`}>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="legend-dot" style={{ backgroundColor: item.color }} />
                    <span className="truncate font-medium text-slate-800">{formatModelLabel(item.model, item.provider)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{item.requests.toLocaleString('en-US')} requests</span>
                    <span>•</span>
                    <span>{formatCompact(item.tokens)} tokens</span>
                    <span>•</span>
                    <span>{formatCurrency(item.cost)}</span>
                  </div>
                </div>
                <span className="font-medium text-slate-700">{share.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function ProjectFilterChip({
  availableProjects,
  onChange,
  selectedProjectIds,
}: ProjectFilterChipProps) {
  const selectedSet = new Set(selectedProjectIds)
  const selectedLabel =
    selectedProjectIds.length === 0 || selectedProjectIds.length === availableProjects.length
      ? availableProjects.length === 1
        ? availableProjects[0]?.projectName || 'Agent'
        : 'All agents'
      : selectedProjectIds.length === 1
        ? availableProjects.find((project) => project.projectId === selectedProjectIds[0])?.projectName || 'Selected agent'
        : `${selectedProjectIds.length} selected agents`

  const toggleProject = (projectId: string) => {
    if (selectedProjectIds.length === 0) {
      onChange(availableProjects.map((project) => project.projectId).filter((id) => id !== projectId))
      return
    }

    if (selectedSet.has(projectId)) {
      const next = selectedProjectIds.filter((id) => id !== projectId)
      onChange(next.length === 0 || next.length === availableProjects.length ? [] : next)
      return
    }

    const next = [...selectedProjectIds, projectId]
    onChange(next.length === availableProjects.length ? [] : next)
  }

  return (
    <details className="relative">
      <summary className="toolbar-chip cursor-pointer list-none">
        <Bot className="size-4" />
        {selectedLabel}
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
          {selectedProjectIds.length === 0 ? 'all' : `${selectedProjectIds.length}/${availableProjects.length}`}
        </span>
      </summary>
      <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-[280px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Agents</p>
            <p className="text-xs text-slate-500">Select one or more agents to compare or roll up.</p>
          </div>
          <Button onClick={() => onChange([])} size="sm" type="button" variant="ghost">
            All
          </Button>
        </div>
        <div className="space-y-2">
          {availableProjects.map((project) => {
            const checked = selectedProjectIds.length === 0 || selectedSet.has(project.projectId)

            return (
              <label
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-slate-300 hover:bg-slate-50"
                key={project.projectId}
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{project.projectName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {project.projectProvider} · {project.projectSlug}
                  </div>
                </div>
                <input
                  checked={checked}
                  className="mt-1 size-4 rounded border-slate-300"
                  onChange={() => toggleProject(project.projectId)}
                  type="checkbox"
                />
              </label>
            )
          })}
        </div>
      </div>
    </details>
  )
}

function ProjectBreakdownCard({ projects }: ProjectBreakdownCardProps) {
  if (projects.length <= 1) {
    return null
  }

  return (
    <Card className="panel-card overflow-hidden">
      <CardHeader className="panel-header-row">
        <div>
          <CardTitle className="panel-title">Agent breakdown</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Compare combined usage against the individual agents contributing to this window.
          </p>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead className="hidden md:table-cell">Identifier</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="hidden md:table-cell text-right">Cached %</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.projectId}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-slate-800">{project.projectName}</span>
                    <span className="text-xs text-slate-500 md:hidden">
                      {project.projectProvider} · {project.projectSlug}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-slate-500">
                  {project.projectProvider} · {project.projectSlug}
                </TableCell>
                <TableCell className="text-right">{project.requests.toLocaleString('en-US')}</TableCell>
                <TableCell className="text-right">{formatCompact(project.totalTokens)}</TableCell>
                <TableCell className="hidden md:table-cell text-right">{(project.cachedShare * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right">{formatCurrency(project.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function ChartCard({ children, footer, legend, title }: ChartCardProps) {
  return (
    <Card className="panel-card">
      <CardHeader className="panel-header-row">
        <div>
          <CardTitle className="panel-title">{title}</CardTitle>
        </div>
        {legend ? <LegendRow items={legend} /> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {footer ? (
          <>
            <Separator />
            {footer}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function LegendRow({ items }: LegendRowProps) {
  return (
    <div className="legend-row">
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span className="legend-dot" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function LegendStats({ items }: LegendStatsProps) {
  return (
    <div className="legend-stats">
      {items.map((item) => (
        <div className="legend-stat-row" key={item.key}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="legend-dot" style={{ backgroundColor: item.accent }} />
            <span className="truncate">{item.label}</span>
          </div>
          <span className="font-medium text-slate-700">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function TrafficBars({ data }: TrafficBarsProps) {
  const maxRequests = Math.max(...data.map((item) => item.primary), 1)

  return (
    <div className="chart-block chart-block-bars">
      {data.map((item) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack">
            <span className="bar bar-grey" style={{ height: `${(item.primary / maxRequests) * 100}%` }} />
            <span className="bar bar-red" style={{ height: `${Math.max(item.secondary, 8)}px` }} />
            <span className="bar bar-violet" style={{ height: `${Math.max(item.tertiary, 8)}%` }} />
          </div>
          <span className="chart-label">{formatDayShort(item.day)}</span>
        </div>
      ))}
    </div>
  )
}

function LineChart({ data, title }: LineChartProps) {
  const primary = toPolylinePoints(data.map((item) => item.primary))
  const secondary = toPolylinePoints(data.map((item) => item.secondary))

  return (
    <svg className="line-chart" viewBox="0 0 320 150" role="img">
      <title>{title}</title>
      <line x1="16" x2="304" y1="130" y2="130" className="chart-axis" />
      <line x1="16" x2="304" y1="92" y2="92" className="chart-gridline" />
      <line x1="16" x2="304" y1="54" y2="54" className="chart-gridline" />
      <polyline className="chart-line chart-line-muted" points={primary} />
      <polyline className="chart-line" points={secondary} />
    </svg>
  )
}

function ModelBars({ data, valueKey }: ModelBarsProps) {
  const maxValue = Math.max(...data.map((item) => item[valueKey]), 1)

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div className="bar-group" key={`${item.provider}:${item.model}:${valueKey}`}>
          <div className="bar-stack bar-stack-wide">
            <span
              className="bar"
              style={{ backgroundColor: item.color, height: `${(item[valueKey] / maxValue) * 100}%` }}
            />
          </div>
          <span className="chart-label chart-label-wide">{formatModelLabel(item.model, item.provider)}</span>
        </div>
      ))}
    </div>
  )
}

function TokenBars({ data }: TokenBarsProps) {
  const maxTokens = Math.max(...data.map((item) => item.inputTokens + item.outputTokens), 1)

  return (
    <div className="chart-block chart-block-bars">
      {data.map((item) => {
        const inputHeight = (item.inputTokens / maxTokens) * 100
        const outputHeight = (item.outputTokens / maxTokens) * 100

        return (
          <div className="bar-group" key={item.day}>
            <div className="bar-stack">
              <span className="bar bar-violet" style={{ height: `${inputHeight}%` }} />
              <span className="bar bar-ink" style={{ height: `${outputHeight}%` }} />
            </div>
            <span className="chart-label">{formatDayShort(item.day)}</span>
          </div>
        )
      })}
    </div>
  )
}

function CostBars({ data }: CostBarsProps) {
  const maxCost = Math.max(...data.map((item) => item.cost), 1)

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack bar-stack-wide">
            <span className="bar bar-magenta" style={{ height: `${(item.cost / maxCost) * 100}%` }} />
          </div>
          <span className="chart-label chart-label-wide">{formatDayShort(item.day)}</span>
        </div>
      ))}
    </div>
  )
}

function getInitialTimeframeSelection(snapshot: DashboardSnapshot): TimeframeSelection {
  const dayCount = snapshot.filters.dailyRows.length

  if (dayCount <= 1) {
    return { endDay: snapshot.filters.availableEndDay, preset: '24h', startDay: snapshot.filters.availableStartDay }
  }

  if (dayCount <= 7) {
    return { endDay: snapshot.filters.availableEndDay, preset: '7d', startDay: snapshot.filters.availableStartDay }
  }

  return { endDay: snapshot.filters.availableEndDay, preset: '30d', startDay: snapshot.filters.availableStartDay }
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function formatModelLabel(model: string, provider: string) {
  return provider ? `${provider} · ${model}` : model
}

function formatBucketLabel(value: string) {
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

function formatDayShort(value: string) {
  const isTimestamp = value.includes('T')
  const date = isTimestamp ? new Date(value) : new Date(`${value}T00:00:00Z`)

  return new Intl.DateTimeFormat('en-US', {
    day: isTimestamp ? undefined : 'numeric',
    hour: isTimestamp ? 'numeric' : undefined,
    minute: isTimestamp ? '2-digit' : undefined,
    month: isTimestamp ? undefined : 'short',
    timeZone: 'UTC',
  }).format(date)
}

function toPolylinePoints(values: number[]) {
  const maxValue = Math.max(...values, 1)

  return values
    .map((value, index) => {
      const x = 16 + index * (288 / Math.max(values.length - 1, 1))
      const y = 130 - (value / maxValue) * 112
      return `${x},${y}`
    })
    .join(' ')
}

const toneClassNameMap = {
  negative: 'text-rose-600',
  neutral: 'text-slate-500',
  positive: 'text-emerald-600',
  warning: 'text-amber-600',
} as const

type ChartCardProps = {
  children: ReactNode
  footer?: ReactNode
  legend?: LegendItem[]
  title: string
}

type LegendItem = {
  color: string
  label: string
}

type LegendRowProps = {
  items: LegendItem[]
}

type LegendStatsProps = {
  items: Array<{
    accent: string
    key: string
    label: string
    value: string
  }>
}

type ProjectFilterChipProps = {
  availableProjects: DashboardSnapshot['projects']['available']
  onChange: (projectIds: string[]) => void
  selectedProjectIds: string[]
}

type ProjectBreakdownCardProps = {
  projects: DashboardProjectSummary[]
}

type DashboardTab = 'overview' | 'models' | 'cost'

type ModelUsageBreakdownCardProps = {
  models: Array<{
    color: string
    cost: number
    model: string
    provider: string
    requests: number
    tokens: number
  }>
}

type TrafficBarsProps = {
  data: Array<{
    day: string
    primary: number
    secondary: number
    tertiary: number
  }>
}

type LineChartProps = {
  data: Array<{
    day: string
    primary: number
    secondary: number
  }>
  title: string
}

type ModelBarsProps = {
  data: Array<{
    color: string
    cost: number
    model: string
    provider: string
    requests: number
    tokens: number
  }>
  valueKey: 'requests' | 'tokens'
}

type TokenBarsProps = {
  data: Array<{
    day: string
    inputTokens: number
    outputTokens: number
  }>
}

type CostBarsProps = {
  data: Array<{
    cost: number
    day: string
  }>
}
