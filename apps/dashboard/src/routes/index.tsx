import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { createFileRoute } from '@tanstack/react-router'
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
import { getAgentDataStatus } from '#/lib/dashboard-agent-status'
import { filterSnapshotByProjects } from '#/lib/dashboard-projects'
import { DASHBOARD_TIME_ZONE } from '#/lib/dashboard-time-zone'
import { filterSnapshotByTimeframe } from '#/lib/dashboard-timeframe'
import type {
  TimeframePreset,
  TimeframeSelection,
} from '#/lib/dashboard-timeframe'
import { loadDashboardSnapshotForRequest } from '#/lib/openai-usage'
import type {
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
  loader: async () => getDashboardSnapshot(),
  component: Home,
})

function Home() {
  const snapshot = Route.useLoaderData()
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [timeframe, setTimeframe] = useState<TimeframeSelection>(() => getInitialTimeframeSelection(snapshot))
  const [trafficChartMode, setTrafficChartMode] = useState<TrafficChartMode>('bars')
  const isNarrowViewport = useIsMobileBreakpoint()
  const projectSnapshot = useMemo(() => filterSnapshotByProjects(snapshot, selectedProjectIds), [selectedProjectIds, snapshot])
  const activeSnapshot = useMemo(() => filterSnapshotByTimeframe(projectSnapshot, timeframe), [projectSnapshot, timeframe])
  const agentDataStatus = useMemo(
    () =>
      getAgentDataStatus(projectSnapshot.headline.generatedAt, {
        latestRollupDay: projectSnapshot.filters.availableEndDay,
      }),
    [
      projectSnapshot.filters.availableEndDay,
      projectSnapshot.headline.generatedAt,
    ],
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
    activeSnapshot.headline.granularity === 'hour' &&
    activeSnapshot.charts.requestsCostCache.length > 12
  const trafficBarData = useMemo(
    () =>
      showTrafficChartModeToggle
        ? aggregateTrafficChartPoints(
            activeSnapshot.charts.requestsCostCache,
            12,
          )
        : activeSnapshot.charts.requestsCostCache.map((item) => ({
            ...item,
            endDay: item.day,
            startDay: item.day,
          })),
    [activeSnapshot.charts.requestsCostCache, showTrafficChartModeToggle],
  )
  const mobileBucketCount = activeSnapshot.headline.granularity === 'hour' ? 8 : 7
  const defaultBarMaxLabels = isNarrowViewport ? 4 : 6
  const compactTrafficTrendData = useMemo(
    () =>
      isNarrowViewport
        ? aggregateTrafficChartPoints(activeSnapshot.charts.requestsCostCache, mobileBucketCount)
        : activeSnapshot.charts.requestsCostCache.map((item) => ({
            ...item,
            endDay: item.day,
            startDay: item.day,
          })),
    [activeSnapshot.charts.requestsCostCache, isNarrowViewport, mobileBucketCount],
  )
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
            onValueChange={(value) => setActiveTab(value as DashboardTab)}
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
            onChange={setSelectedProjectIds}
            selectedProjectIds={selectedProjectIds}
          />
          <div className="toolbar-chip gap-3">
            <CalendarRange className="size-4" />
            <Select
              onValueChange={(value) => {
                const preset = value as TimeframePreset
                setTimeframe((current) => ({
                  endDay:
                    current.endDay || projectSnapshot.filters.availableEndDay,
                  preset,
                  startDay:
                    current.startDay ||
                    projectSnapshot.filters.availableStartDay,
                }))
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
                  setTimeframe((current) => ({
                    ...current,
                    startDay: event.target.value,
                  }))
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
                  setTimeframe((current) => ({
                    ...current,
                    endDay: event.target.value,
                  }))
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
                      aria-pressed={trafficChartMode === 'bars'}
                      className="chart-mode-button"
                      onClick={() => setTrafficChartMode('bars')}
                      size="xs"
                      type="button"
                      variant={
                        trafficChartMode === 'bars' ? 'secondary' : 'ghost'
                      }
                    >
                      12 bars
                    </Button>
                    <Button
                      aria-pressed={trafficChartMode === 'line'}
                      className="chart-mode-button"
                      onClick={() => setTrafficChartMode('line')}
                      size="xs"
                      type="button"
                      variant={
                        trafficChartMode === 'line' ? 'secondary' : 'ghost'
                      }
                    >
                      24h line
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
              {trafficChartMode === 'line' && showTrafficChartModeToggle ? (
                <TrafficTrendChart data={compactTrafficTrendData} title="Requests, cost, and cache trends" />
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
                    {activeSnapshot.table.map((row) => (
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
                      aria-pressed={trafficChartMode === 'bars'}
                      className="chart-mode-button"
                      onClick={() => setTrafficChartMode('bars')}
                      size="xs"
                      type="button"
                      variant={
                        trafficChartMode === 'bars' ? 'secondary' : 'ghost'
                      }
                    >
                      12 bars
                    </Button>
                    <Button
                      aria-pressed={trafficChartMode === 'line'}
                      className="chart-mode-button"
                      onClick={() => setTrafficChartMode('line')}
                      size="xs"
                      type="button"
                      variant={
                        trafficChartMode === 'line' ? 'secondary' : 'ghost'
                      }
                    >
                      24h line
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
              {trafficChartMode === 'line' && showTrafficChartModeToggle ? (
                <TrafficTrendChart data={compactTrafficTrendData} title="Requests, cost, and cache trends" />
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
                  {activeSnapshot.table.map((row) => (
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
    <details className="relative">
      <summary className="toolbar-chip cursor-pointer list-none">
        <Bot className="size-4" />
        {selectedLabel}
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
          {selectedProjectIds.length === 0
            ? 'all'
            : `${selectedProjectIds.length}/${availableProjects.length}`}
        </span>
      </summary>
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
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">
                    {project.projectName}
                  </div>
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
                    <span className="text-xs text-slate-500 md:hidden">
                      {project.projectProvider} · {project.projectSlug}
                    </span>
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
  const requestSegments = toPolylineSegments(data.map((item) => ({ missing: item.missing, value: item.primary })))
  const costSegments = toPolylineSegments(data.map((item) => ({ missing: item.missing, value: item.secondary })))
  const cacheSegments = toPolylineSegments(data.map((item) => ({ missing: item.missing, value: item.tertiary })))

  return (
    <svg className="line-chart" viewBox="0 0 320 150" role="img">
      <title>{title}</title>
      <line x1="16" x2="304" y1="130" y2="130" className="chart-axis" />
      <line x1="16" x2="304" y1="92" y2="92" className="chart-gridline" />
      <line x1="16" x2="304" y1="54" y2="54" className="chart-gridline" />
      {requestSegments.map((points, index) => (
        <polyline className="chart-line chart-line-grey" key={`requests-${index}`} points={points} />
      ))}
      {costSegments.map((points, index) => (
        <polyline className="chart-line chart-line-red" key={`cost-${index}`} points={points} />
      ))}
      {cacheSegments.map((points, index) => (
        <polyline className="chart-line chart-line-muted" key={`cache-${index}`} points={points} />
      ))}
    </svg>
  )
}

function LineChart({ data, title }: LineChartProps) {
  const primarySegments = toPolylineSegments(data.map((item) => ({ missing: item.missing, value: item.primary })))
  const secondarySegments = toPolylineSegments(data.map((item) => ({ missing: item.missing, value: item.secondary })))

  return (
    <svg className="line-chart" viewBox="0 0 320 150" role="img">
      <title>{title}</title>
      <line x1="16" x2="304" y1="130" y2="130" className="chart-axis" />
      <line x1="16" x2="304" y1="92" y2="92" className="chart-gridline" />
      <line x1="16" x2="304" y1="54" y2="54" className="chart-gridline" />
      {primarySegments.map((points, index) => (
        <polyline className="chart-line chart-line-muted" key={`primary-${index}`} points={points} />
      ))}
      {secondarySegments.map((points, index) => (
        <polyline className="chart-line" key={`secondary-${index}`} points={points} />
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

  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: compact ? undefined : '2-digit',
    timeZone: DASHBOARD_TIME_ZONE,
  })

  return `${formatter.format(start)}-${formatter.format(end)}`
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

function toPolylineSegments(points: Array<{ missing?: boolean; value: number }>) {
  const presentValues = points.filter((point) => !point.missing).map((point) => point.value)
  const maxValue = Math.max(...presentValues, 1)
  const segments: string[] = []
  let currentSegment: string[] = []

  points.forEach((point, index) => {
    if (point.missing) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment.join(' '))
      }
      currentSegment = []
      return
    }

    const x = 16 + index * (288 / Math.max(points.length - 1, 1))
    const y = 130 - (point.value / maxValue) * 112
    currentSegment.push(`${x},${y}`)
  })

  if (currentSegment.length >= 2) {
    segments.push(currentSegment.join(' '))
  }

  return segments
}

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
