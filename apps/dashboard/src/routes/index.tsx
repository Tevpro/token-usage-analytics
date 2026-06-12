import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarRange,
  RefreshCcw,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  aggregateDualMetricChartPoints,
  aggregateSingleMetricChartPoints,
  aggregateTrafficChartPoints,
} from '#/lib/chart-presentation'
import { getAgentDataStatus, getAggregateAgentDataStatus } from '#/lib/dashboard-agent-status'
import { filterSnapshotByProjects } from '#/lib/dashboard-projects'
import { DASHBOARD_TIME_ZONE } from '#/lib/dashboard-time-zone'
import { filterSnapshotByTimeframe } from '#/lib/dashboard-timeframe'
import type {
  TimeframePreset,
  TimeframeSelection,
} from '#/lib/dashboard-timeframe'
import { loadDashboardSnapshotForRequest } from '#/lib/openai-usage'
import type {
  DashboardProjectOption,
  DashboardProjectSummary,
  DashboardSnapshot,
} from '#/lib/token-analytics'

const getDashboardSnapshot = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRuntimeEnv } = await import('#/lib/worker-env')
    const result = await loadDashboardSnapshotForRequest(getRuntimeEnv())
    return result.snapshot
  },
)

export const Route = createFileRoute('/')({
  validateSearch: (search) => parseDashboardSearch(search),
  loader: async () => getDashboardSnapshot(),
  component: Home,
})

function Home() {
  const snapshot = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const isNarrowViewport = useIsMobileBreakpoint()
  const defaultTimeframe = useMemo(() => getInitialTimeframeSelection(snapshot), [snapshot])
  const availableProjectIds = useMemo(
    () => snapshot.projects.available.map((project) => project.projectId),
    [snapshot.projects.available],
  )
  const activeTab = search.tab ?? 'overview'
  const trafficChartMode = search.trafficMode ?? 'bars'
  const selectedProjectIds = useMemo(
    () => parseSelectedProjectIds(search.projects, availableProjectIds),
    [availableProjectIds, search.projects],
  )
  const timeframe = useMemo(
    () => getSearchBackedTimeframe(search, defaultTimeframe),
    [defaultTimeframe, search],
  )
  const updateSearch = (next: Partial<DashboardSearch>) =>
    navigate({
      replace: true,
      search: (current: DashboardSearch) => sanitizeDashboardSearch({ ...current, ...next }, defaultTimeframe, availableProjectIds),
    })
  const projectSnapshot = useMemo(() => filterSnapshotByProjects(snapshot, selectedProjectIds), [selectedProjectIds, snapshot])
  const activeSnapshot = useMemo(() => filterSnapshotByTimeframe(projectSnapshot, timeframe), [projectSnapshot, timeframe])
  const selectedProjects = useMemo(() => {
    if (selectedProjectIds.length === 0 || selectedProjectIds.length === availableProjectIds.length) {
      return snapshot.projects.available
    }

    const selectedSet = new Set(selectedProjectIds)
    return snapshot.projects.available.filter((project) => selectedSet.has(project.projectId))
  }, [availableProjectIds.length, selectedProjectIds, snapshot.projects.available])
  const newestFirstRollups: typeof activeSnapshot.table = useMemo(
    () => [...activeSnapshot.table].sort((left, right) => right.day.localeCompare(left.day)),
    [activeSnapshot.table],
  )
  const agentDataStatus = useMemo(
    () => getAggregateAgentDataStatus(selectedProjects),
    [selectedProjects],
  )
  const bucketLabel =
    activeSnapshot.headline.granularity === 'hour' ? 'Hourly' : 'Daily'
  const bucketColumnLabel =
    activeSnapshot.headline.granularity === 'hour' ? 'Time' : 'Day'
  const costChartTitle =
    activeSnapshot.headline.granularity === 'hour'
      ? 'Allocated hourly cost'
      : 'Allocated daily cost'
  const showTrafficChartModeToggle =
    activeSnapshot.charts.requestsCostCache.length > 2
  const useAggregatedTrafficBars =
    activeSnapshot.headline.granularity === 'hour' &&
    activeSnapshot.charts.requestsCostCache.length > 12
  const effectiveTrafficChartMode =
    showTrafficChartModeToggle ? trafficChartMode : 'bars'
  const trafficBarData = useMemo(
    () =>
      useAggregatedTrafficBars
        ? aggregateTrafficChartPoints(
            activeSnapshot.charts.requestsCostCache,
            12,
          )
        : activeSnapshot.charts.requestsCostCache.map((item) => ({
            ...item,
            endDay: item.day,
            startDay: item.day,
          })),
    [activeSnapshot.charts.requestsCostCache, useAggregatedTrafficBars],
  )
  const trafficLineData = useMemo(
    () => activeSnapshot.charts.requestsCostCache,
    [activeSnapshot.charts.requestsCostCache],
  )
  const mobileBucketCount = activeSnapshot.headline.granularity === 'hour' ? 8 : 7
  const defaultBarMaxLabels = isNarrowViewport ? 4 : 6
  const compactInputOutputData = useMemo(
    () =>
      isNarrowViewport
        ? aggregateDualMetricChartPoints(activeSnapshot.charts.inputOutput, mobileBucketCount)
        : activeSnapshot.charts.inputOutput,
    [activeSnapshot.charts.inputOutput, isNarrowViewport, mobileBucketCount],
  )
  const compactTokenVolumeData = useMemo(
    () =>
      isNarrowViewport
        ? aggregateDualMetricChartPoints(
            activeSnapshot.charts.tokenVolume.map((item) => ({
              day: item.day,
              primary: item.inputTokens,
              secondary: item.outputTokens,
            })),
            mobileBucketCount,
          ).map((item) => ({
            day: item.day,
            inputTokens: item.primary,
            outputTokens: item.secondary,
          }))
        : activeSnapshot.charts.tokenVolume,
    [activeSnapshot.charts.tokenVolume, isNarrowViewport, mobileBucketCount],
  )
  const compactCostByDayData = useMemo(
    () =>
      isNarrowViewport
        ? aggregateSingleMetricChartPoints(
            activeSnapshot.charts.costByDay.map((item) => ({ day: item.day, value: item.cost })),
            mobileBucketCount,
          ).map((item) => ({ day: item.day, cost: item.value }))
        : activeSnapshot.charts.costByDay,
    [activeSnapshot.charts.costByDay, isNarrowViewport, mobileBucketCount],
  )
  const rotateDenseTickLabels =
    Math.max(trafficBarData.length, compactTokenVolumeData.length, compactCostByDayData.length) > defaultBarMaxLabels
  const trafficMaxLabels = rotateDenseTickLabels ? trafficBarData.length : defaultBarMaxLabels
  const tokenMaxLabels = rotateDenseTickLabels ? compactTokenVolumeData.length : defaultBarMaxLabels
  const costMaxLabels = rotateDenseTickLabels ? compactCostByDayData.length : defaultBarMaxLabels
  const trafficSummaryItems = useMemo(
    () => [
      {
        accent: 'var(--chart-grey)',
        key: 'traffic-requests',
        label: 'Requests',
        value: activeSnapshot.charts.requestsCostCache.reduce((sum, item) => sum + item.primary, 0).toLocaleString('en-US'),
      },
      {
        accent: 'var(--chart-red)',
        key: 'traffic-cost',
        label: 'Allocated cost',
        value: formatCurrency(activeSnapshot.charts.requestsCostCache.reduce((sum, item) => sum + item.secondary, 0) / 10),
      },
      {
        accent: 'var(--chart-violet)',
        key: 'traffic-cache',
        label: 'Avg cached',
        value: `${calculateAverageTrafficCacheShare(activeSnapshot.charts.requestsCostCache).toFixed(0)}%`,
      },
    ],
    [activeSnapshot.charts.requestsCostCache],
  )
  const inputOutputSummaryItems = useMemo(
    () => [
      {
        accent: 'var(--chart-violet)',
        key: 'input-total',
        label: 'Input tokens',
        value: formatCompact(activeSnapshot.charts.inputOutput.reduce((sum, item) => sum + item.primary, 0)),
      },
      {
        accent: 'var(--chart-ink)',
        key: 'output-total',
        label: 'Output tokens',
        value: formatCompact(activeSnapshot.charts.inputOutput.reduce((sum, item) => sum + item.secondary, 0)),
      },
    ],
    [activeSnapshot.charts.inputOutput],
  )
  const costSummaryItems = useMemo(
    () => [
      {
        accent: 'var(--chart-magenta)',
        key: 'cost-total',
        label: 'Total cost',
        value: formatCurrency(activeSnapshot.charts.costByDay.reduce((sum, item) => sum + item.cost, 0)),
      },
      {
        accent: 'var(--chart-magenta)',
        key: 'cost-peak',
        label: 'Peak bucket',
        value: formatCurrency(Math.max(...activeSnapshot.charts.costByDay.map((item) => item.cost), 0)),
      },
    ],
    [activeSnapshot.charts.costByDay],
  )

  return (
    <main className="dashboard-shell">
      <section className="dashboard-header">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="dashboard-kicker">Token observability</p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="dashboard-title">Token usage</h1>
                <p className="max-w-3xl text-sm text-slate-600">
                  {activeSnapshot.headline.summary}
                </p>
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
                <Button
                  className="dashboard-feedback-button"
                  onClick={() => window.location.reload()}
                  variant="outline"
                >
                  <RefreshCcw className="size-4" />
                  Refresh view
                </Button>
              </div>
            </div>
          </div>

          <Tabs
            className="w-full"
            onValueChange={(value) => updateSearch({ tab: value as DashboardTab })}
            value={activeTab}
          >
            <TabsList className="dashboard-tabs-list">
              <TabsTrigger className="dashboard-tab-trigger" value="overview">
                Overview
              </TabsTrigger>
              <TabsTrigger className="dashboard-tab-trigger" value="models">
                Models
              </TabsTrigger>
              <TabsTrigger className="dashboard-tab-trigger" value="cost">
                Cost
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      <section className="dashboard-toolbar">
        <div className="toolbar-chip-group">
          <ProjectFilterChip
            availableProjects={snapshot.projects.available}
            onChange={(projectIds) => updateSearch({ projects: serializeSelectedProjectIds(projectIds, availableProjectIds) })}
            selectedProjectIds={selectedProjectIds}
          />
          <div className="toolbar-chip gap-3">
            <CalendarRange className="size-4" />
            <Select
              onValueChange={(value) => {
                const preset = value as TimeframePreset
                const nextTimeframe = {
                  endDay: timeframe.endDay || projectSnapshot.filters.availableEndDay,
                  preset,
                  startDay: timeframe.startDay || projectSnapshot.filters.availableStartDay,
                }

                updateSearch({
                  endDay: preset === 'custom' ? nextTimeframe.endDay : undefined,
                  preset,
                  startDay: preset === 'custom' ? nextTimeframe.startDay : undefined,
                })
              }}
              value={timeframe.preset}
            >
              <SelectTrigger className="h-8 w-[148px] border-0 bg-transparent px-0 text-left text-sm font-medium text-slate-700 shadow-none focus:ring-0">
                <SelectValue aria-label="Timeframe">
                  {getTimeframeTriggerLabel(projectSnapshot, timeframe)}
                </SelectValue>
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
                max={
                  timeframe.endDay || projectSnapshot.filters.availableEndDay
                }
                min={projectSnapshot.filters.availableStartDay}
                onChange={(event) =>
                  updateSearch({
                    endDay: timeframe.endDay || projectSnapshot.filters.availableEndDay,
                    preset: 'custom',
                    startDay: event.target.value,
                  })
                }
                type="date"
                value={
                  timeframe.startDay ||
                  projectSnapshot.filters.availableStartDay
                }
              />
              <span className="text-slate-400">→</span>
              <Input
                aria-label="End date"
                className="h-8 w-[132px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                max={projectSnapshot.filters.availableEndDay}
                min={
                  timeframe.startDay ||
                  projectSnapshot.filters.availableStartDay
                }
                onChange={(event) =>
                  updateSearch({
                    endDay: event.target.value,
                    preset: 'custom',
                    startDay: timeframe.startDay || projectSnapshot.filters.availableStartDay,
                  })
                }
                type="date"
                value={
                  timeframe.endDay || projectSnapshot.filters.availableEndDay
                }
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="kpi-grid">
        {activeSnapshot.kpis.map((kpi) => (
          <Card key={kpi.label} className="kpi-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-slate-950">
                {kpi.value}
              </div>
              <p className={`mt-2 text-sm ${toneClassNameMap[kpi.tone]}`}>
                {activeSnapshot.headline.sourceLabel}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      {activeTab === 'overview' ? (
        <>
          <section className="analytics-grid analytics-grid-top">
            <ChartCard
              action={
                showTrafficChartModeToggle ? (
                  <div
                    className="chart-mode-toggle"
                    role="group"
                    aria-label="Traffic chart display mode"
                  >
                    <Button
                      aria-pressed={effectiveTrafficChartMode === 'bars'}
                      className="chart-mode-button"
                      onClick={() => updateSearch({ trafficMode: 'bars' })}
                      size="xs"
                      type="button"
                      variant={
                        effectiveTrafficChartMode === 'bars' ? 'secondary' : 'ghost'
                      }
                    >
                      {useAggregatedTrafficBars ? '12 bars' : 'Bars'}
                    </Button>
                    <Button
                      aria-pressed={effectiveTrafficChartMode === 'line'}
                      className="chart-mode-button"
                      onClick={() => updateSearch({ trafficMode: 'line' })}
                      size="xs"
                      type="button"
                      variant={
                        effectiveTrafficChartMode === 'line' ? 'secondary' : 'ghost'
                      }
                    >
                      Line
                    </Button>
                  </div>
                ) : null
              }
              footer={isNarrowViewport ? <LegendStats items={trafficSummaryItems} /> : undefined}
              legend={[
                { label: 'Requests', color: 'var(--chart-grey)' },
                { label: 'Cost ×10', color: 'var(--chart-red)' },
                { label: 'Cached %', color: 'var(--chart-violet)' },
              ]}
              title="Requests / Cost / Cache"
            >
              {effectiveTrafficChartMode === 'line' ? (
                <TrafficTrendChart data={trafficLineData} title="Requests, cost, and cache trends" />
              ) : (
                <TrafficBars
                  compactLabels={isNarrowViewport}
                  data={trafficBarData}
                  maxLabels={trafficMaxLabels}
                  rotateLabels={rotateDenseTickLabels}
                />
              )}
            </ChartCard>

            <ChartCard
              footer={isNarrowViewport ? <LegendStats items={inputOutputSummaryItems} /> : undefined}
              legend={[
                { label: 'Input tokens', color: 'var(--chart-violet)' },
                { label: 'Output tokens', color: 'var(--chart-ink)' },
              ]}
              title="Input vs output"
            >
              <LineChart data={compactInputOutputData} title="Input and output tokens" />
            </ChartCard>

            <Card className="panel-card panel-card-signals">
              <CardHeader className="panel-header-row">
                <div>
                  <CardTitle className="panel-title">Signals</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="issue-list-shell p-0">
                <div className="issue-list issue-list-scroll">
                  {activeSnapshot.issues.map((issue) => (
                    <div
                      className="issue-row"
                      key={`${issue.severity}:${issue.title}`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge className="issue-badge" variant="secondary">
                          {issue.severity}
                        </Badge>
                        <span className="truncate text-sm text-indigo-700">
                          {issue.title}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-slate-600">
                        {issue.count}
                      </span>
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

          <section className="space-y-6">
            <ProjectBreakdownCard
              projects={activeSnapshot.projects.breakdown}
            />

            <Card className="panel-card overflow-hidden daily-rollups-card">
              <CardHeader className="panel-header-row">
                <div>
                  <CardTitle className="panel-title">
                    {bucketLabel} rollups
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {activeSnapshot.headline.granularity === 'hour'
                      ? 'Hourly buckets expose the last 24 hours of request, token, cache, and allocated cost activity for faster troubleshooting.'
                      : 'Daily rollups cached in D1 for fast reads on Workers, regardless of whether the source is Hermes, OpenAI, or another provider.'}
                  </p>
                </div>
                <Badge
                  className="daily-rollups-badge rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600"
                  variant="secondary"
                >
                  <Activity className="mr-1 size-3.5" />
                  {formatRefreshBasisLabel(
                    activeSnapshot.headline.generatedAt,
                  )}{' '}
                  refresh basis
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                <Table className="daily-rollups-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="hidden sm:table-cell">
                        Trace ID
                      </TableHead>
                      <TableHead>{bucketColumnLabel}</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Total Tokens</TableHead>
                      <TableHead className="hidden lg:table-cell text-right">
                        Input
                      </TableHead>
                      <TableHead className="hidden lg:table-cell text-right">
                        Output
                      </TableHead>
                      <TableHead className="hidden md:table-cell text-right">
                        Cached %
                      </TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newestFirstRollups.map((row: (typeof newestFirstRollups)[number]) => (
                      <TableRow key={row.traceId}>
                        <TableCell className="hidden font-medium text-indigo-700 sm:table-cell">
                          {row.traceId}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span>{formatBucketLabel(row.day)}</span>
                            <span className="text-xs text-slate-500 sm:hidden">
                              {row.traceId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.requests.toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCompact(row.totalTokens)}
                        </TableCell>
                        <TableCell className="hidden text-right lg:table-cell">
                          {formatCompact(row.inputTokens)}
                        </TableCell>
                        <TableCell className="hidden text-right lg:table-cell">
                          {formatCompact(row.outputTokens)}
                        </TableCell>
                        <TableCell className="hidden text-right md:table-cell">
                          {(row.cachedShare * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          ${row.cost.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
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
              <ModelBars
                data={activeSnapshot.charts.models}
                valueKey="requests"
              />
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
              <TokenBars
                compactLabels={isNarrowViewport}
                data={compactTokenVolumeData}
                maxLabels={tokenMaxLabels}
                rotateLabels={rotateDenseTickLabels}
              />
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
              <CostBars
                compactLabels={isNarrowViewport}
                data={compactCostByDayData}
                maxLabels={costMaxLabels}
                rotateLabels={rotateDenseTickLabels}
              />
            </ChartCard>
          </section>
        </div>
      ) : null}

      {activeTab === 'cost' ? (
        <>
          <section className="analytics-grid analytics-grid-top">
            <ChartCard
              action={
                showTrafficChartModeToggle ? (
                  <div
                    className="chart-mode-toggle"
                    role="group"
                    aria-label="Traffic chart display mode"
                  >
                    <Button
                      aria-pressed={effectiveTrafficChartMode === 'bars'}
                      className="chart-mode-button"
                      onClick={() => updateSearch({ trafficMode: 'bars' })}
                      size="xs"
                      type="button"
                      variant={
                        effectiveTrafficChartMode === 'bars' ? 'secondary' : 'ghost'
                      }
                    >
                      {useAggregatedTrafficBars ? '12 bars' : 'Bars'}
                    </Button>
                    <Button
                      aria-pressed={effectiveTrafficChartMode === 'line'}
                      className="chart-mode-button"
                      onClick={() => updateSearch({ trafficMode: 'line' })}
                      size="xs"
                      type="button"
                      variant={
                        effectiveTrafficChartMode === 'line' ? 'secondary' : 'ghost'
                      }
                    >
                      Line
                    </Button>
                  </div>
                ) : null
              }
              footer={isNarrowViewport ? <LegendStats items={trafficSummaryItems} /> : undefined}
              legend={[
                { label: 'Requests', color: 'var(--chart-grey)' },
                { label: 'Cost ×10', color: 'var(--chart-red)' },
                { label: 'Cached %', color: 'var(--chart-violet)' },
              ]}
              title="Requests / Cost / Cache"
            >
              {effectiveTrafficChartMode === 'line' ? (
                <TrafficTrendChart data={trafficLineData} title="Requests, cost, and cache trends" />
              ) : (
                <TrafficBars
                  compactLabels={isNarrowViewport}
                  data={trafficBarData}
                  maxLabels={trafficMaxLabels}
                  rotateLabels={rotateDenseTickLabels}
                />
              )}
            </ChartCard>

            <ChartCard
              footer={isNarrowViewport ? <LegendStats items={inputOutputSummaryItems} /> : undefined}
              legend={[
                { label: 'Input tokens', color: 'var(--chart-violet)' },
                { label: 'Output tokens', color: 'var(--chart-ink)' },
              ]}
              title="Input vs output"
            >
              <LineChart data={compactInputOutputData} title="Input and output tokens" />
            </ChartCard>

            <ChartCard footer={isNarrowViewport ? <LegendStats items={costSummaryItems} /> : undefined} title={costChartTitle}>
              <CostBars
                compactLabels={isNarrowViewport}
                data={compactCostByDayData}
                maxLabels={costMaxLabels}
                rotateLabels={rotateDenseTickLabels}
              />
            </ChartCard>
          </section>

          <ProjectBreakdownCard projects={activeSnapshot.projects.breakdown} />

          <Card className="panel-card overflow-hidden daily-rollups-card">
            <CardHeader className="panel-header-row">
              <div>
                <CardTitle className="panel-title">
                  {bucketLabel} rollups
                </CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Review the request, token, cache, and cost totals behind the
                  current cost window.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="daily-rollups-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">
                      Trace ID
                    </TableHead>
                    <TableHead>{bucketColumnLabel}</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Total Tokens</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      Cached %
                    </TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newestFirstRollups.map((row: (typeof newestFirstRollups)[number]) => (
                    <TableRow key={`${row.traceId}:cost`}>
                      <TableCell className="hidden font-medium text-indigo-700 sm:table-cell">
                        {row.traceId}
                      </TableCell>
                      <TableCell>{formatBucketLabel(row.day)}</TableCell>
                      <TableCell className="text-right">
                        {row.requests.toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCompact(row.totalTokens)}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {(row.cachedShare * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.cost)}
                      </TableCell>
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
            More than one model was active in this window, so this view breaks
            usage down by token share.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {models.map((item) => {
            const share =
              totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0

            return (
              <span
                className="h-full"
                key={`${item.provider}:${item.model}:share-bar`}
                style={{
                  backgroundColor: item.color,
                  width: `${Math.max(share, 3)}%`,
                }}
              />
            )
          })}
        </div>

        <div className="legend-stats">
          {models.map((item) => {
            const share =
              totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0

            return (
              <div
                className="legend-stat-row"
                key={`${item.provider}:${item.model}:share-row`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="legend-dot"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate font-medium text-slate-800">
                      {formatModelLabel(item.model, item.provider)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>
                      {item.requests.toLocaleString('en-US')} requests
                    </span>
                    <span>•</span>
                    <span>{formatCompact(item.tokens)} tokens</span>
                    <span>•</span>
                    <span>{formatCurrency(item.cost)}</span>
                  </div>
                </div>
                <span className="font-medium text-slate-700">
                  {share.toFixed(1)}%
                </span>
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
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedSet = new Set(selectedProjectIds)
  const selectedLabel =
    selectedProjectIds.length === 0 ||
    selectedProjectIds.length === availableProjects.length
      ? availableProjects.length === 1
        ? availableProjects[0]?.projectName || 'Agent'
        : 'All agents'
      : selectedProjectIds.length === 1
        ? availableProjects.find(
            (project) => project.projectId === selectedProjectIds[0],
          )?.projectName || 'Selected agent'
        : `${selectedProjectIds.length} selected agents`

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const toggleProject = (projectId: string) => {
    if (selectedProjectIds.length === 0) {
      onChange(
        availableProjects
          .map((project) => project.projectId)
          .filter((id) => id !== projectId),
      )
      return
    }

    if (selectedSet.has(projectId)) {
      const next = selectedProjectIds.filter((id) => id !== projectId)
      onChange(
        next.length === 0 || next.length === availableProjects.length
          ? []
          : next,
      )
      return
    }

    const next = [...selectedProjectIds, projectId]
    onChange(next.length === availableProjects.length ? [] : next)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        className="toolbar-chip cursor-pointer"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <Bot className="size-4" />
        {selectedLabel}
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
          {selectedProjectIds.length === 0
            ? 'all'
            : `${selectedProjectIds.length}/${availableProjects.length}`}
        </span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-[280px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Agents</p>
              <p className="text-xs text-slate-500">
                Select one or more agents to compare or roll up.
              </p>
            </div>
            <Button
              onClick={() => onChange([])}
              size="sm"
              type="button"
              variant="ghost"
            >
              All
            </Button>
          </div>
          <div className="space-y-2">
            {availableProjects.map((project) => {
              const checked =
                selectedProjectIds.length === 0 ||
                selectedSet.has(project.projectId)

              return (
                <label
                  className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-slate-300 hover:bg-slate-50"
                  key={project.projectId}
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="font-medium text-slate-800">
                      {project.projectName}
                    </div>
                    <div>
                      <AgentStatusIndicator project={project} />
                    </div>
                    <div className="text-xs text-slate-500">
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
      ) : null}
    </div>
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
            Compare combined usage against the individual agents contributing to
            this window.
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
              <TableHead className="hidden md:table-cell text-right">
                Cached %
              </TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.projectId}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-slate-800">
                      {project.projectName}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <AgentStatusIndicator project={project} />
                      <span className="md:hidden">
                        {project.projectProvider} · {project.projectSlug}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-slate-500">
                  {project.projectProvider} · {project.projectSlug}
                </TableCell>
                <TableCell className="text-right">
                  {project.requests.toLocaleString('en-US')}
                </TableCell>
                <TableCell className="text-right">
                  {formatCompact(project.totalTokens)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-right">
                  {(project.cachedShare * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(project.cost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AgentStatusIndicator({ project }: AgentStatusIndicatorProps) {
  const status = getAgentDataStatus(project.latestGeneratedAt || '', {
    latestRollupDay: project.latestRollupDay || undefined,
  })

  return (
    <span
      className={`dashboard-inline-status dashboard-status-${status.level}`}
      title={status.detail}
    >
      <span aria-hidden className="dashboard-status-dot" />
      <span>{status.label}</span>
    </span>
  )
}

function ChartCard({
  action,
  children,
  footer,
  legend,
  title,
}: ChartCardProps) {
  return (
    <Card className="panel-card">
      <CardHeader className="panel-header-row">
        <div>
          <CardTitle className="panel-title">{title}</CardTitle>
        </div>
        <div className="chart-header-actions">
          {action}
          {legend ? <LegendRow items={legend} /> : null}
        </div>
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
          <span
            className="legend-dot"
            style={{ backgroundColor: item.color }}
          />
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
            <span
              className="legend-dot"
              style={{ backgroundColor: item.accent }}
            />
            <span className="truncate">{item.label}</span>
          </div>
          <span className="font-medium text-slate-700">{item.value}</span>
        </div>
      ))}
    </div>
  )
}

function TrafficBars({ compactLabels = false, data, maxLabels = 6, rotateLabels = false }: TrafficBarsProps) {
  const maxRequests = Math.max(...data.map((item) => item.primary), 1)
  const maxCost = Math.max(...data.map((item) => item.secondary), 1)

  return (
    <div className={rotateLabels ? 'chart-block chart-block-bars chart-block-bars-rotated' : 'chart-block chart-block-bars'}>
      {data.map((item, index) => (
        <div className="bar-group" key={`${item.startDay}:${item.endDay}`}>
          <div className="bar-stack">
            <span
              className="bar bar-grey"
              style={{ height: `${(item.primary / maxRequests) * 100}%` }}
            />
            <span
              className="bar bar-red"
              style={{
                height: `${Math.max((item.secondary / maxCost) * 100, 8)}%`,
              }}
            />
            <span
              className="bar bar-violet"
              style={{ height: `${Math.max(item.tertiary, 8)}%` }}
            />
          </div>
          {shouldRenderTick(index, data.length, maxLabels) ? (
            rotateLabels ? (
              <span className="chart-label chart-label-rotated-slot">
                <span className="chart-label-rotated-text">
                  {formatTrafficBucketLabel(item.startDay, item.endDay, compactLabels)}
                </span>
              </span>
            ) : (
              <span className="chart-label">
                {formatTrafficBucketLabel(item.startDay, item.endDay, compactLabels)}
              </span>
            )
          ) : (
            <span
              aria-hidden
              className={rotateLabels ? 'chart-label chart-label-placeholder chart-label-rotated-slot' : 'chart-label chart-label-placeholder'}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function TrafficTrendChart({ data, title }: TrafficTrendChartProps) {
  const requestSeries = buildLineChartSeries(
    data.map((item) => ({ missing: item.missing, value: item.primary })),
    { fillMissingWithZero: true },
  )
  const costSeries = buildLineChartSeries(
    data.map((item) => ({ missing: item.missing, value: item.secondary })),
    { fillMissingWithZero: true },
  )
  const cacheSeries = buildLineChartSeries(
    data.map((item) => ({ missing: item.missing, value: item.tertiary })),
    { fillMissingWithZero: true },
  )
  const ticks = buildLineChartTicks(data.map((item) => item.day))
  const hoverTargets = buildLineChartHoverTargets(data.length)

  return (
    <svg className="line-chart" viewBox={`0 0 320 ${LINE_CHART_VIEWBOX_HEIGHT}`} role="img">
      <title>{title}</title>
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1={LINE_CHART_BOTTOM} y2={LINE_CHART_BOTTOM} className="chart-axis" />
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1="89" y2="89" className="chart-gridline" />
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1="52" y2="52" className="chart-gridline" />
      {requestSeries.segments.map((points, index) => (
        <polyline className="chart-line chart-line-grey" key={`requests-${index}`} points={points} />
      ))}
      {costSeries.segments.map((points, index) => (
        <polyline className="chart-line chart-line-red" key={`cost-${index}`} points={points} />
      ))}
      {cacheSeries.segments.map((points, index) => (
        <polyline className="chart-line chart-line-muted" key={`cache-${index}`} points={points} />
      ))}
      {requestSeries.points.map((point) => (
        <circle className="chart-point chart-point-grey" cx={point.x} cy={point.y} key={`requests-point-${point.index}`} r="2.5" />
      ))}
      {costSeries.points.map((point) => (
        <circle className="chart-point chart-point-red" cx={point.x} cy={point.y} key={`cost-point-${point.index}`} r="2.5" />
      ))}
      {cacheSeries.points.map((point) => (
        <circle className="chart-point chart-point-muted" cx={point.x} cy={point.y} key={`cache-point-${point.index}`} r="2.5" />
      ))}
      {hoverTargets.map((target, index) => (
        <g key={`traffic-hover-${data[index]?.day ?? index}`}>
          <title>{formatTrafficTooltip(data[index])}</title>
          <rect className="chart-hover-target" height={LINE_CHART_HEIGHT} width={target.width} x={target.x} y={LINE_CHART_TOP} />
        </g>
      ))}
      {ticks.map((tick) => (
        <g key={`traffic-tick-${tick.day}`}>
          <title>{formatBucketLabel(tick.day)}</title>
          <text className="chart-axis-label" textAnchor="middle" x={tick.x} y={LINE_CHART_LABEL_Y}>
            {formatLineAxisLabel(tick.day)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function LineChart({ data, title }: LineChartProps) {
  const primarySeries = buildLineChartSeries(
    data.map((item) => ({ missing: item.missing, value: item.primary })),
    { fillMissingWithZero: true },
  )
  const secondarySeries = buildLineChartSeries(
    data.map((item) => ({ missing: item.missing, value: item.secondary })),
    { fillMissingWithZero: true },
  )
  const ticks = buildLineChartTicks(data.map((item) => item.day))
  const hoverTargets = buildLineChartHoverTargets(data.length)

  return (
    <svg className="line-chart" viewBox={`0 0 320 ${LINE_CHART_VIEWBOX_HEIGHT}`} role="img">
      <title>{title}</title>
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1={LINE_CHART_BOTTOM} y2={LINE_CHART_BOTTOM} className="chart-axis" />
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1="89" y2="89" className="chart-gridline" />
      <line x1={LINE_CHART_LEFT} x2={LINE_CHART_RIGHT} y1="52" y2="52" className="chart-gridline" />
      {primarySeries.segments.map((points, index) => (
        <polyline className="chart-line chart-line-muted" key={`primary-${index}`} points={points} />
      ))}
      {secondarySeries.segments.map((points, index) => (
        <polyline className="chart-line" key={`secondary-${index}`} points={points} />
      ))}
      {primarySeries.points.map((point) => (
        <circle className="chart-point chart-point-muted" cx={point.x} cy={point.y} key={`primary-point-${point.index}`} r="2.5" />
      ))}
      {secondarySeries.points.map((point) => (
        <circle className="chart-point" cx={point.x} cy={point.y} key={`secondary-point-${point.index}`} r="2.5" />
      ))}
      {hoverTargets.map((target, index) => (
        <g key={`input-output-hover-${data[index]?.day ?? index}`}>
          <title>{formatInputOutputTooltip(data[index])}</title>
          <rect className="chart-hover-target" height={LINE_CHART_HEIGHT} width={target.width} x={target.x} y={LINE_CHART_TOP} />
        </g>
      ))}
      {ticks.map((tick) => (
        <g key={`input-output-tick-${tick.day}`}>
          <title>{formatBucketLabel(tick.day)}</title>
          <text className="chart-axis-label" textAnchor="middle" x={tick.x} y={LINE_CHART_LABEL_Y}>
            {formatLineAxisLabel(tick.day)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function ModelBars({ data, valueKey }: ModelBarsProps) {
  const maxValue = Math.max(...data.map((item) => item[valueKey]), 1)

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item, index) => (
        <div
          aria-label={`${item.model}: ${item[valueKey].toLocaleString('en-US')}`}
          className="bar-group"
          key={`${item.provider}:${item.model}:${valueKey}`}
          title={item.model}
        >
          <div className="bar-stack bar-stack-wide">
            <span
              className="bar"
              style={{
                backgroundColor: item.color,
                height: `${(item[valueKey] / maxValue) * 100}%`,
              }}
            />
          </div>
          {shouldRenderTick(index, data.length, 4) ? (
            <span className="chart-label chart-label-wide" title={formatModelLabel(item.model, item.provider)}>
              {formatModelTick(item.model)}
            </span>
          ) : (
            <span aria-hidden className="chart-label chart-label-placeholder chart-label-wide" />
          )}
        </div>
      ))}
    </div>
  )
}

function TokenBars({ compactLabels = false, data, maxLabels = 6, rotateLabels = false }: TokenBarsProps) {
  const maxTokens = Math.max(...data.map((item) => item.inputTokens + item.outputTokens), 1)

  return (
    <div className={rotateLabels ? 'chart-block chart-block-bars chart-block-bars-rotated' : 'chart-block chart-block-bars'}>
      {data.map((item, index) => {
        const inputHeight = (item.inputTokens / maxTokens) * 100
        const outputHeight = (item.outputTokens / maxTokens) * 100

        return (
          <div className="bar-group" key={item.day}>
            <div className="bar-stack">
              <span
                className="bar bar-violet"
                style={{ height: `${inputHeight}%` }}
              />
              <span
                className="bar bar-ink"
                style={{ height: `${outputHeight}%` }}
              />
            </div>
            {shouldRenderTick(index, data.length, maxLabels) ? (
              rotateLabels ? (
                <span className="chart-label chart-label-rotated-slot" title={formatBucketLabel(item.day)}>
                  <span className="chart-label-rotated-text">
                    {formatDayShort(item.day, compactLabels)}
                  </span>
                </span>
              ) : (
                <span className="chart-label" title={formatBucketLabel(item.day)}>
                  {formatDayShort(item.day, compactLabels)}
                </span>
              )
            ) : (
              <span
                aria-hidden
                className={rotateLabels ? 'chart-label chart-label-placeholder chart-label-rotated-slot' : 'chart-label chart-label-placeholder'}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function CostBars({ compactLabels = false, data, maxLabels = 6, rotateLabels = false }: CostBarsProps) {
  const maxCost = Math.max(...data.map((item) => item.cost), 1)

  return (
    <div className={rotateLabels ? 'chart-block chart-block-bars chart-block-thick chart-block-bars-rotated' : 'chart-block chart-block-bars chart-block-thick'}>
      {data.map((item, index) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack bar-stack-wide">
            <span
              className="bar bar-magenta"
              style={{ height: `${(item.cost / maxCost) * 100}%` }}
            />
          </div>
          {shouldRenderTick(index, data.length, maxLabels) ? (
            rotateLabels ? (
              <span className="chart-label chart-label-rotated-slot" title={formatBucketLabel(item.day)}>
                <span className="chart-label-rotated-text">
                  {formatDayShort(item.day, compactLabels)}
                </span>
              </span>
            ) : (
              <span className="chart-label chart-label-wide" title={formatBucketLabel(item.day)}>
                {formatDayShort(item.day, compactLabels)}
              </span>
            )
          ) : (
            <span
              aria-hidden
              className={rotateLabels ? 'chart-label chart-label-placeholder chart-label-rotated-slot' : 'chart-label chart-label-placeholder chart-label-wide'}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function useIsMobileBreakpoint(maxWidth = 640) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const update = () => setMatches(mediaQuery.matches)

    update()
    mediaQuery.addEventListener('change', update)

    return () => mediaQuery.removeEventListener('change', update)
  }, [maxWidth])

  return matches
}

function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const tab = getDashboardTabParam(search.tab)
  const preset = getTimeframePresetParam(search.preset)
  const startDay = getIsoDayParam(search.startDay)
  const endDay = getIsoDayParam(search.endDay)
  const projects = getProjectsParam(search.projects)
  const trafficMode = getTrafficChartModeParam(search.trafficMode)

  return {
    endDay,
    preset,
    projects,
    startDay,
    tab,
    trafficMode,
  }
}

function getSearchBackedTimeframe(search: DashboardSearch, fallback: TimeframeSelection): TimeframeSelection {
  return {
    endDay: search.endDay ?? fallback.endDay,
    preset: search.preset ?? fallback.preset,
    startDay: search.startDay ?? fallback.startDay,
  }
}

function parseSelectedProjectIds(projects: string | undefined, availableProjectIds: string[]) {
  if (!projects) {
    return []
  }

  const selected = projects
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (selected.length === 0) {
    return []
  }

  const selectedSet = new Set(selected)
  const ordered = availableProjectIds.filter((projectId) => selectedSet.has(projectId))

  return ordered.length === 0 || ordered.length === availableProjectIds.length ? [] : ordered
}

function serializeSelectedProjectIds(selectedProjectIds: string[], availableProjectIds: string[]) {
  if (selectedProjectIds.length === 0 || selectedProjectIds.length === availableProjectIds.length) {
    return undefined
  }

  const selectedSet = new Set(selectedProjectIds)
  const ordered = availableProjectIds.filter((projectId) => selectedSet.has(projectId))

  return ordered.join(',') || undefined
}

function sanitizeDashboardSearch(
  search: DashboardSearch,
  defaultTimeframe: TimeframeSelection,
  availableProjectIds: string[],
): DashboardSearch {
  const projects = serializeSelectedProjectIds(
    parseSelectedProjectIds(search.projects, availableProjectIds),
    availableProjectIds,
  )

  const normalizedPreset = search.preset ?? defaultTimeframe.preset
  const startDay = getIsoDayParam(search.startDay)
  const endDay = getIsoDayParam(search.endDay)

  return {
    endDay:
      normalizedPreset === 'custom' && endDay !== defaultTimeframe.endDay
        ? endDay
        : undefined,
    preset: normalizedPreset !== defaultTimeframe.preset ? normalizedPreset : undefined,
    projects,
    startDay:
      normalizedPreset === 'custom' && startDay !== defaultTimeframe.startDay
        ? startDay
        : undefined,
    tab: search.tab && search.tab !== 'overview' ? search.tab : undefined,
    trafficMode: search.trafficMode === 'line' ? 'line' : undefined,
  }
}

function getDashboardTabParam(value: unknown): DashboardTab | undefined {
  return value === 'overview' || value === 'models' || value === 'cost' ? value : undefined
}

function getTrafficChartModeParam(value: unknown): TrafficChartMode | undefined {
  return value === 'bars' || value === 'line' ? value : undefined
}

function getTimeframePresetParam(value: unknown): TimeframePreset | undefined {
  return value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === 'custom'
    ? value
    : undefined
}

function getIsoDayParam(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function getProjectsParam(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function getInitialTimeframeSelection(snapshot: DashboardSnapshot): TimeframeSelection {
  const dayCount = snapshot.filters.dailyRows.length

  if (dayCount <= 1) {
    return {
      endDay: snapshot.filters.availableEndDay,
      preset: '24h',
      startDay: snapshot.filters.availableStartDay,
    }
  }

  if (dayCount <= 7) {
    return {
      endDay: snapshot.filters.availableEndDay,
      preset: '7d',
      startDay: snapshot.filters.availableStartDay,
    }
  }

  return {
    endDay: snapshot.filters.availableEndDay,
    preset: '30d',
    startDay: snapshot.filters.availableStartDay,
  }
}

function getTimeframeTriggerLabel(snapshot: DashboardSnapshot, selection: TimeframeSelection) {
  if (selection.preset === 'custom') {
    return 'Custom range'
  }

  const availableDayCount = snapshot.filters.dailyRows.length
  const requestedDayCount =
    selection.preset === '24h'
      ? 1
      : selection.preset === '7d'
        ? 7
        : selection.preset === '30d'
          ? 30
          : 90

  if (availableDayCount < requestedDayCount) {
    return formatCompactDateRange(
      snapshot.filters.availableStartDay,
      snapshot.filters.availableEndDay,
    )
  }

  return selection.preset === '24h'
    ? 'Last 24 hours'
    : selection.preset === '7d'
      ? 'Last 7 days'
      : selection.preset === '30d'
        ? 'Last 30 days'
        : 'Last 90 days'
}

function formatCompactDateRange(startDay: string, endDay: string) {
  if (!startDay || !endDay) {
    return 'Select window'
  }

  if (startDay === endDay) {
    return formatShortToolbarDay(startDay)
  }

  const start = new Date(`${startDay}T00:00:00Z`)
  const end = new Date(`${endDay}T00:00:00Z`)
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()

  if (sameMonth) {
    return `${formatShortToolbarMonthDay(start)}–${end.getUTCDate()}`
  }

  return `${formatShortToolbarMonthDay(start)}–${formatShortToolbarMonthDay(end)}`
}

function formatShortToolbarDay(value: string) {
  return formatShortToolbarMonthDay(new Date(`${value}T00:00:00Z`))
}

function formatShortToolbarMonthDay(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(value)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)
}

function calculateAverageTrafficCacheShare(data: Array<{ primary: number; tertiary: number }>) {
  if (data.length === 0) {
    return 0
  }

  const totalRequests = data.reduce((sum, item) => sum + item.primary, 0)

  if (totalRequests > 0) {
    return data.reduce((sum, item) => sum + item.primary * item.tertiary, 0) / totalRequests
  }

  return data.reduce((sum, item) => sum + item.tertiary, 0) / data.length
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function formatModelLabel(model: string, provider: string) {
  return provider ? `${provider} · ${model}` : model
}

function formatModelTick(model: string) {
  const trimmed = model.trim()
  const slashSegment = trimmed.split('/').pop() ?? trimmed
  const colonSegment = slashSegment.split(':').pop() ?? slashSegment
  return colonSegment
}

function formatBucketLabel(value: string) {
  const isTimestamp = value.includes('T')
  const date = isTimestamp ? new Date(value) : new Date(`${value}T00:00:00Z`)

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: isTimestamp ? 'numeric' : undefined,
    minute: isTimestamp ? '2-digit' : undefined,
    month: 'short',
    timeZone: isTimestamp ? DASHBOARD_TIME_ZONE : 'UTC',
    year: 'numeric',
  }).format(date)
}

function formatDayShort(value: string, compact = false) {
  const isTimestamp = value.includes('T')
  const date = isTimestamp ? new Date(value) : new Date(`${value}T00:00:00Z`)

  return new Intl.DateTimeFormat('en-US', {
    day: compact || !isTimestamp ? 'numeric' : undefined,
    hour: isTimestamp ? 'numeric' : undefined,
    minute: isTimestamp && !compact ? '2-digit' : undefined,
    month: compact ? 'numeric' : isTimestamp ? undefined : 'short',
    timeZone: isTimestamp ? DASHBOARD_TIME_ZONE : 'UTC',
  }).format(date)
}

function formatLineAxisLabel(value: string) {
  const isTimestamp = value.includes('T')
  const date = isTimestamp ? new Date(value) : new Date(`${value}T00:00:00Z`)

  if (isTimestamp) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      timeZone: DASHBOARD_TIME_ZONE,
    })
      .format(date)
      .replace(/\s/g, '')
      .toLowerCase()
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(date)
    .toLowerCase()
}

function shouldRenderTick(index: number, total: number, maxLabels = 6) {
  if (total <= maxLabels) return true
  if (index === 0 || index === total - 1) return true

  const stride = Math.max(1, Math.ceil((total - 1) / (maxLabels - 1)))
  return index % stride === 0
}

function formatTrafficBucketLabel(startDay: string, endDay: string, compact = false) {
  if (startDay === endDay) {
    return formatDayShort(startDay, compact)
  }

  const start = new Date(startDay)
  const end = new Date(endDay)

  if (!startDay.includes('T') && !endDay.includes('T')) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: compact ? 'numeric' : 'short',
      timeZone: 'UTC',
    })

    return `${formatter.format(start)}-${formatter.format(end)}`
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    timeZone: DASHBOARD_TIME_ZONE,
  })
    .format(start)
    .replace(/\s/g, '')
    .toLowerCase()
}

function formatRefreshBasisLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
  }).format(new Date(value))
}

function toPolylineSegments(
  points: Array<{ missing?: boolean; value: number }>,
  options?: { fillMissingWithZero?: boolean },
) {
  const maxValue = getLineChartMaxValue(points)
  const segments: string[] = []
  let currentSegment: string[] = []

  points.forEach((point, index) => {
    if (point.missing && !options?.fillMissingWithZero) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment.join(' '))
      }
      currentSegment = []
      return
    }

    const value = point.missing && options?.fillMissingWithZero ? 0 : point.value
    currentSegment.push(`${getLineChartX(index, points.length)},${getLineChartY(value, maxValue)}`)
  })

  if (currentSegment.length >= 2) {
    segments.push(currentSegment.join(' '))
  }

  return segments
}

function buildLineChartSeries(
  points: Array<{ missing?: boolean; value: number }>,
  options?: { fillMissingWithZero?: boolean },
) {
  const maxValue = getLineChartMaxValue(points)

  return {
    points: points.flatMap((point, index) => {
      if (point.missing) {
        return []
      }

      return [{
        index,
        value: point.value,
        x: getLineChartX(index, points.length),
        y: getLineChartY(point.value, maxValue),
      }]
    }),
    segments: toPolylineSegments(points, options),
  }
}

function buildLineChartTicks(days: string[], maxLabels = 6) {
  return days.flatMap((day, index) => {
    if (!shouldRenderTick(index, days.length, maxLabels)) {
      return []
    }

    return [{
      day,
      x: getLineChartX(index, days.length),
    }]
  })
}

function buildLineChartHoverTargets(total: number) {
  if (total === 0) {
    return []
  }

  const slotWidth = total > 1 ? LINE_CHART_WIDTH / (total - 1) : LINE_CHART_WIDTH

  return Array.from({ length: total }, (_, index) => ({
    width: slotWidth,
    x: Math.max(0, Math.min(320 - slotWidth, getLineChartX(index, total) - slotWidth / 2)),
  }))
}

function getLineChartMaxValue(points: Array<{ missing?: boolean; value: number }>) {
  const presentValues = points.filter((point) => !point.missing).map((point) => point.value)
  return Math.max(...presentValues, 1)
}

function getLineChartX(index: number, total: number) {
  return LINE_CHART_LEFT + index * (LINE_CHART_WIDTH / Math.max(total - 1, 1))
}

function getLineChartY(value: number, maxValueOrPoints: number | Array<{ missing?: boolean; value: number }>) {
  const maxValue =
    typeof maxValueOrPoints === 'number'
      ? maxValueOrPoints
      : getLineChartMaxValue(maxValueOrPoints)

  return LINE_CHART_BOTTOM - (value / maxValue) * LINE_CHART_HEIGHT
}

function formatTrafficTooltip(point: TrafficTrendChartProps['data'][number]) {
  return [
    formatBucketLabel(point.day),
    `Requests: ${point.primary.toLocaleString('en-US')}`,
    `Allocated cost: ${formatCurrency(point.secondary / 10)}`,
    `Cached share: ${point.tertiary.toFixed(1)}%`,
  ].join('\n')
}

function formatInputOutputTooltip(point: LineChartProps['data'][number]) {
  return [
    formatBucketLabel(point.day),
    `Input tokens: ${point.primary.toLocaleString('en-US')}`,
    `Output tokens: ${point.secondary.toLocaleString('en-US')}`,
  ].join('\n')
}

const LINE_CHART_LEFT = 16
const LINE_CHART_RIGHT = 304
const LINE_CHART_TOP = 16
const LINE_CHART_BOTTOM = 126
const LINE_CHART_LABEL_Y = 140
const LINE_CHART_VIEWBOX_HEIGHT = 156
const LINE_CHART_WIDTH = LINE_CHART_RIGHT - LINE_CHART_LEFT
const LINE_CHART_HEIGHT = LINE_CHART_BOTTOM - LINE_CHART_TOP

const toneClassNameMap = {
  negative: 'text-rose-600',
  neutral: 'text-slate-500',
  positive: 'text-emerald-600',
  warning: 'text-amber-600',
} as const

type ChartCardProps = {
  action?: ReactNode
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

type AgentStatusIndicatorProps = {
  project: Pick<DashboardProjectOption, 'latestGeneratedAt' | 'latestRollupDay'>
}

type DashboardSearch = {
  endDay?: string
  preset?: TimeframePreset
  projects?: string
  startDay?: string
  tab?: DashboardTab
  trafficMode?: TrafficChartMode
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
  compactLabels?: boolean
  data: Array<{
    day: string
    endDay: string
    primary: number
    secondary: number
    startDay: string
    tertiary: number
  }>
  maxLabels?: number
  rotateLabels?: boolean
}

type TrafficTrendChartProps = {
  data: Array<{
    day: string
    missing?: boolean
    primary: number
    secondary: number
    tertiary: number
  }>
  title: string
}

type TrafficChartMode = 'bars' | 'line'

type LineChartProps = {
  data: Array<{
    day: string
    missing?: boolean
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
  compactLabels?: boolean
  data: Array<{
    day: string
    inputTokens: number
    missing?: boolean
    outputTokens: number
  }>
  maxLabels?: number
  rotateLabels?: boolean
}

type CostBarsProps = {
  compactLabels?: boolean
  data: Array<{
    cost: number
    day: string
    missing?: boolean
  }>
  maxLabels?: number
  rotateLabels?: boolean
}
