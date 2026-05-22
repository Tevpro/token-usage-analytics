import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarRange,
  ChartNoAxesCombined,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { buildDashboardSnapshot } from '#/lib/token-analytics'

const getDashboardSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  return buildDashboardSnapshot()
})

export const Route = createFileRoute('/')({
  loader: async () => getDashboardSnapshot(),
  component: Home,
})

function Home() {
  const snapshot = Route.useLoaderData()

  return (
    <main className="dashboard-shell">
      <section className="dashboard-header">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="dashboard-kicker">Token observability</p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="dashboard-title">Agents</h1>
                <p className="max-w-3xl text-sm text-slate-600">
                  {snapshot.headline.summary}
                </p>
              </div>
              <Button className="dashboard-feedback-button" variant="outline">
                <Sparkles className="size-4" />
                Product notes
              </Button>
            </div>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="dashboard-tabs-list">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="tools">Tools</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      <section className="dashboard-toolbar">
        <div className="toolbar-chip-group">
          <button className="toolbar-chip" type="button">
            <Bot className="size-4" />
            {snapshot.headline.workspace}
          </button>
          <button className="toolbar-chip" type="button">
            <ChartNoAxesCombined className="size-4" />
            {snapshot.headline.environment}
          </button>
          <button className="toolbar-chip toolbar-chip-wide" type="button">
            <CalendarRange className="size-4" />
            {snapshot.headline.rangeLabel}
          </button>
        </div>

        <label className="toolbar-search">
          <Search className="size-4 text-slate-400" />
          <Input
            aria-label="Search spans, users, tags, and more"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            defaultValue=""
            placeholder="Search spans, users, tags, and more"
          />
        </label>
      </section>

      <section className="kpi-grid">
        {snapshot.kpis.map((kpi) => (
          <Card key={kpi.label} className="kpi-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{kpi.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-slate-950">{kpi.value}</div>
              <p className={`mt-2 text-sm ${toneClassNameMap[kpi.tone]}`}>{kpi.deltaLabel}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="analytics-grid analytics-grid-top">
        <ChartCard
          legend={[
            { label: 'Requests', color: 'var(--chart-grey)' },
            { label: 'Error Rate', color: 'var(--chart-red)' },
            { label: 'Cache %', color: 'var(--chart-violet)' },
          ]}
          title="Traffic"
        >
          <TrafficBars data={snapshot.charts.traffic} />
        </ChartCard>

        <ChartCard
          legend={[
            { label: 'avg latency', color: 'var(--chart-violet)' },
            { label: 'p95 latency', color: 'var(--chart-ink)' },
          ]}
          title="Duration"
        >
          <LatencyLines data={snapshot.charts.latency} />
        </ChartCard>

        <Card className="panel-card">
          <CardHeader className="panel-header-row">
            <div>
              <CardTitle className="panel-title">Issues</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="issue-list">
              {snapshot.issues.map((issue) => (
                <div className="issue-row" key={issue.title}>
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

      <section className="analytics-grid analytics-grid-bottom">
        <ChartCard
          footer={
            <LegendStats
              items={snapshot.charts.llmCalls.map((item) => ({
                label: item.model,
                value: item.requests.toLocaleString('en-US'),
                accent: item.color,
              }))}
            />
          }
          title="LLM Calls"
        >
          <ModelBars data={snapshot.charts.llmCalls} />
        </ChartCard>

        <ChartCard
          footer={
            <LegendStats
              items={snapshot.charts.llmCalls.map((item) => ({
                label: item.model,
                value: formatCompact(item.tokens),
                accent: item.color,
              }))}
            />
          }
          title="Tokens Used"
        >
          <TokenBars data={snapshot.charts.tokensUsed} />
        </ChartCard>

        <ChartCard
          footer={
            <LegendStats
              items={snapshot.charts.toolCalls.map((item) => ({
                label: item.tool,
                value: item.calls.toLocaleString('en-US'),
                accent: 'var(--chart-violet)',
              }))}
            />
          }
          title="Tool Calls"
        >
          <ToolBars data={snapshot.charts.toolCalls} />
        </ChartCard>
      </section>

      <section className="callout-strip">
        {snapshot.callouts.map((callout) => (
          <article className="callout-card" key={callout}>
            <ArrowUpRight className="mt-0.5 size-4 text-indigo-600" />
            <p>{callout}</p>
          </article>
        ))}
      </section>

      <Card className="panel-card overflow-hidden">
        <CardHeader className="panel-header-row">
          <div>
            <CardTitle className="panel-title">Daily rollups</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              The table shape is intentionally aligned to a D1 rollup table, one row per day and workspace.
            </p>
          </div>
          <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600" variant="secondary">
            <Activity className="mr-1 size-3.5" />
            Worker-ready foundation
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trace ID</TableHead>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Total Tokens</TableHead>
                <TableHead className="text-right">Avg Latency</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.table.map((row) => (
                <TableRow key={row.traceId}>
                  <TableCell className="font-medium text-indigo-700">{row.traceId}</TableCell>
                  <TableCell>{formatDay(row.day)}</TableCell>
                  <TableCell className="text-right">{row.requests.toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right">{formatCompact(row.totalTokens)}</TableCell>
                  <TableCell className="text-right">{Math.round(row.avgLatencyMs)} ms</TableCell>
                  <TableCell className="text-right">{row.errors}</TableCell>
                  <TableCell className="text-right">${row.cost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="delivery-strip">
        <div>
          <p className="dashboard-kicker">Suggested build sequence</p>
          <h2 className="text-xl font-semibold text-slate-950">
            Ingestion first, then rollups, then filters, then cost guardrails.
          </h2>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Wrench className="size-4" />
          This repo ships with the UI shell, Cloudflare deployment wiring, and an issue board for the real data path.
        </div>
      </section>
    </main>
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
        <div className="legend-stat-row" key={item.label}>
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
  const maxRequests = Math.max(...data.map((item) => item.primary))

  return (
    <div className="chart-block chart-block-bars">
      {data.map((item) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack">
            <span className="bar bar-grey" style={{ height: `${(item.primary / maxRequests) * 100}%` }} />
            <span className="bar bar-red" style={{ height: `${Math.max(item.secondary * 14, 8)}px` }} />
            <span className="bar bar-violet" style={{ height: `${Math.max(item.tertiary, 8)}%` }} />
          </div>
          <span className="chart-label">{formatDayShort(item.day)}</span>
        </div>
      ))}
    </div>
  )
}

function LatencyLines({ data }: LatencyLinesProps) {
  const pointsA = toPolylinePoints(data.map((item) => item.primary))
  const pointsB = toPolylinePoints(data.map((item) => item.secondary))

  return (
    <svg className="line-chart" viewBox="0 0 320 150" role="img">
      <title>Latency chart</title>
      <line x1="16" x2="304" y1="130" y2="130" className="chart-axis" />
      <line x1="16" x2="304" y1="92" y2="92" className="chart-gridline" />
      <line x1="16" x2="304" y1="54" y2="54" className="chart-gridline" />
      <polyline className="chart-line chart-line-muted" points={pointsA} />
      <polyline className="chart-line" points={pointsB} />
    </svg>
  )
}

function ModelBars({ data }: ModelBarsProps) {
  const maxRequests = Math.max(...data.map((item) => item.requests))

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div className="bar-group" key={item.model}>
          <div className="bar-stack bar-stack-wide">
            <span className="bar" style={{ backgroundColor: item.color, height: `${(item.requests / maxRequests) * 100}%` }} />
          </div>
          <span className="chart-label chart-label-wide">{item.model.replace('-sonnet-4', '')}</span>
        </div>
      ))}
    </div>
  )
}

function TokenBars({ data }: TokenBarsProps) {
  const maxTokens = Math.max(...data.map((item) => item.inputTokens + item.outputTokens))

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

function ToolBars({ data }: ToolBarsProps) {
  const maxCalls = Math.max(...data.map((item) => item.calls))

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div className="bar-group" key={item.tool}>
          <div className="bar-stack bar-stack-wide">
            <span className="bar bar-magenta" style={{ height: `${Math.max((item.errorRate * 100) / 1.5, 12)}%` }} />
            <span className="bar bar-violet" style={{ height: `${(item.calls / maxCalls) * 100}%` }} />
          </div>
          <span className="chart-label chart-label-wide">{item.tool}</span>
        </div>
      ))}
    </div>
  )
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatDayShort(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`))
}

function toPolylinePoints(values: number[]) {
  const maxValue = Math.max(...values)

  return values
    .map((value, index) => {
      const x = 16 + index * (288 / Math.max(values.length - 1, 1))
      const y = 130 - (value / maxValue) * 112
      return `${x},${y}`
    })
    .join(' ')
}

const toneClassNameMap = {
  neutral: 'text-slate-500',
  positive: 'text-emerald-600',
  warning: 'text-amber-600',
} as const

type ChartCardProps = {
  children: React.ReactNode
  footer?: React.ReactNode
  legend?: LegendItem[]
  title: string
}

type LegendItem = {
  label: string
  color: string
}

type LegendRowProps = {
  items: LegendItem[]
}

type LegendStatsProps = {
  items: Array<{
    label: string
    value: string
    accent: string
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

type LatencyLinesProps = {
  data: Array<{
    day: string
    primary: number
    secondary: number
  }>
}

type ModelBarsProps = {
  data: Array<{
    model: string
    provider: string
    requests: number
    tokens: number
    cost: number
    color: string
  }>
}

type TokenBarsProps = {
  data: Array<{
    day: string
    inputTokens: number
    outputTokens: number
  }>
}

type ToolBarsProps = {
  data: Array<{
    tool: string
    calls: number
    errorRate: number
  }>
}
