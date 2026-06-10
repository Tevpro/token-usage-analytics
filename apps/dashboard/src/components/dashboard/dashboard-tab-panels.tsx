import { Activity, ArrowUpRight } from 'lucide-react'

import {
ChartCard,
CostBars,
LegendStats,
LineChart,
ModelBars,
TokenBars,
TrafficBars,
} from '#/components/dashboard/dashboard-charts'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
Table,
TableBody,
TableCell,
TableHead,
TableHeader,
TableRow,
} from '#/components/ui/table'
import type {
DashboardProjectSummary,
DashboardSnapshot,
} from '#/lib/token-analytics'
import {
formatCompact,
formatCurrency,
formatDay,
formatHoustonTimestamp,
formatModelLabel,
} from '#/lib/dashboard-view'

type DashboardTabPanelProps = {
snapshot: DashboardSnapshot
}

export function OverviewTabPanel({ snapshot }: DashboardTabPanelProps) {
return (
<>
<section className="analytics-grid analytics-grid-top">
<ChartCard
legend={[
{ color: 'var(--chart-grey)', label: 'Requests' },
{ color: 'var(--chart-red)', label: 'Cost ×10' },
{ color: 'var(--chart-violet)', label: 'Cached %' },
]}
title="Requests / Cost / Cache"
>
<TrafficBars data={snapshot.charts.requestsCostCache} />
</ChartCard>

<ChartCard
legend={[
{ color: 'var(--chart-violet)', label: 'Input tokens' },
{ color: 'var(--chart-ink)', label: 'Output tokens' },
]}
title="Input vs output"
>
<LineChart
data={snapshot.charts.inputOutput}
title="Input and output tokens"
/>
</ChartCard>

<SignalsCard issues={snapshot.issues} />
</section>

<CalloutStrip callouts={snapshot.callouts} />

<section className="space-y-6">
<ProjectBreakdownCard projects={snapshot.projects.breakdown} />
<DailyRollupsCard
generatedAt={snapshot.headline.generatedAt}
rows={snapshot.table}
variant="full"
/>
</section>
</>
)
}

export function ModelsTabPanel({ snapshot }: DashboardTabPanelProps) {
return (
<div className="space-y-6">
<ModelUsageBreakdownCard models={snapshot.charts.models} />

<section className="analytics-grid analytics-grid-bottom">
<ChartCard
footer={
<LegendStats
items={snapshot.charts.models.map((item) => ({
accent: item.color,
key: `${item.provider}:${item.model}:requests`,
label: formatModelLabel(item.model, item.provider),
value: item.requests.toLocaleString('en-US'),
}))}
/>
}
title="Model requests"
>
<ModelBars data={snapshot.charts.models} valueKey="requests" />
</ChartCard>

<ChartCard
footer={
<LegendStats
items={snapshot.charts.models.map((item) => ({
accent: item.color,
key: `${item.provider}:${item.model}:tokens`,
label: formatModelLabel(item.model, item.provider),
value: formatCompact(item.tokens),
}))}
/>
}
title="Token volume"
>
<TokenBars data={snapshot.charts.tokenVolume} />
</ChartCard>

<ChartCard
footer={
<LegendStats
items={snapshot.charts.models.map((item) => ({
accent: item.color,
key: `${item.provider}:${item.model}:cost`,
label: formatModelLabel(item.model, item.provider),
value: formatCurrency(item.cost),
}))}
/>
}
title="Allocated daily cost"
>
<CostBars data={snapshot.charts.costByDay} />
</ChartCard>
</section>
</div>
)
}

export function CostTabPanel({ snapshot }: DashboardTabPanelProps) {
return (
<>
<section className="analytics-grid analytics-grid-top">
<ChartCard
legend={[
{ color: 'var(--chart-grey)', label: 'Requests' },
{ color: 'var(--chart-red)', label: 'Cost ×10' },
{ color: 'var(--chart-violet)', label: 'Cached %' },
]}
title="Requests / Cost / Cache"
>
<TrafficBars data={snapshot.charts.requestsCostCache} />
</ChartCard>

<ChartCard
legend={[
{ color: 'var(--chart-violet)', label: 'Input tokens' },
{ color: 'var(--chart-ink)', label: 'Output tokens' },
]}
title="Input vs output"
>
<LineChart
data={snapshot.charts.inputOutput}
title="Input and output tokens"
/>
</ChartCard>

<ChartCard title="Allocated daily cost">
<CostBars data={snapshot.charts.costByDay} />
</ChartCard>
</section>

<ProjectBreakdownCard projects={snapshot.projects.breakdown} />
<DailyRollupsCard
generatedAt={snapshot.headline.generatedAt}
rows={snapshot.table}
variant="cost"
/>
</>
)
}

function SignalsCard({ issues }: { issues: DashboardSnapshot['issues'] }) {
return (
<Card className="panel-card panel-card-signals">
<CardHeader className="panel-header-row">
<div>
<CardTitle className="panel-title">Signals</CardTitle>
</div>
</CardHeader>
<CardContent className="p-0">
<div className="issue-list">
{issues.map((issue) => (
<div className="issue-row" key={`${issue.severity}:${issue.title}`}>
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
)
}

function CalloutStrip({
callouts,
}: {
callouts: DashboardSnapshot['callouts']
}) {
return (
<section className="callout-strip">
{callouts.map((callout) => (
<article className="callout-card" key={callout}>
<ArrowUpRight className="mt-0.5 size-4 text-indigo-600" />
<p>{callout}</p>
</article>
))}
</section>
)
}

function ProjectBreakdownCard({
projects,
}: {
projects: DashboardProjectSummary[]
}) {
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
<TableCell className="hidden text-slate-500 md:table-cell">
{project.projectProvider} · {project.projectSlug}
</TableCell>
<TableCell className="text-right">
{project.requests.toLocaleString('en-US')}
</TableCell>
<TableCell className="text-right">
{formatCompact(project.totalTokens)}
</TableCell>
<TableCell className="hidden text-right md:table-cell">
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

function ModelUsageBreakdownCard({
models,
}: {
models: DashboardSnapshot['charts']['models']
}) {
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

function DailyRollupsCard({
generatedAt,
rows,
variant,
}: {
generatedAt: string
rows: DashboardSnapshot['table']
variant: 'cost' | 'full'
}) {
return (
<Card className="panel-card overflow-hidden daily-rollups-card">
<CardHeader className="panel-header-row">
<div>
<CardTitle className="panel-title">Daily rollups</CardTitle>
<p className="mt-1 text-sm text-slate-500">
{variant === 'full'
? 'Daily rollups cached in D1 for fast reads on Workers, regardless of whether the source is Hermes, OpenAI, or another provider.'
: 'Review the daily request, token, cache, and cost totals behind the current cost window.'}
</p>
</div>
{variant === 'full' ? (
<Badge
className="daily-rollups-badge rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600"
variant="secondary"
>
<Activity className="mr-1 size-3.5" />
{formatHoustonTimestamp(generatedAt)} refresh basis
</Badge>
) : null}
</CardHeader>
<CardContent className="p-0">
<Table className="daily-rollups-table">
<TableHeader>
<TableRow>
<TableHead className="hidden sm:table-cell">Trace ID</TableHead>
<TableHead>Day</TableHead>
<TableHead className="text-right">Requests</TableHead>
<TableHead className="text-right">Total Tokens</TableHead>
{variant === 'full' ? (
<>
<TableHead className="hidden text-right lg:table-cell">
Input
</TableHead>
<TableHead className="hidden text-right lg:table-cell">
Output
</TableHead>
</>
) : null}
<TableHead className="hidden text-right md:table-cell">
Cached %
</TableHead>
<TableHead className="text-right">Cost</TableHead>
</TableRow>
</TableHeader>
<TableBody>
{rows.map((row) => (
<TableRow
key={variant === 'full' ? row.traceId : `${row.traceId}:cost`}
>
<TableCell className="hidden font-medium text-indigo-700 sm:table-cell">
{row.traceId}
</TableCell>
<TableCell>
{variant === 'full' ? (
<div className="flex flex-col gap-1">
<span>{formatDay(row.day)}</span>
<span className="text-xs text-slate-500 sm:hidden">
{row.traceId}
</span>
</div>
) : (
formatDay(row.day)
)}
</TableCell>
<TableCell className="text-right">
{row.requests.toLocaleString('en-US')}
</TableCell>
<TableCell className="text-right">
{formatCompact(row.totalTokens)}
</TableCell>
{variant === 'full' ? (
<>
<TableCell className="hidden text-right lg:table-cell">
{formatCompact(row.inputTokens)}
</TableCell>
<TableCell className="hidden text-right lg:table-cell">
{formatCompact(row.outputTokens)}
</TableCell>
</>
) : null}
<TableCell className="hidden text-right md:table-cell">
{(row.cachedShare * 100).toFixed(1)}%
</TableCell>
<TableCell className="text-right">
{variant === 'full'
? `$${row.cost.toFixed(2)}`
: formatCurrency(row.cost)}
</TableCell>
</TableRow>
))}
</TableBody>
</Table>
</CardContent>
</Card>
)
}
