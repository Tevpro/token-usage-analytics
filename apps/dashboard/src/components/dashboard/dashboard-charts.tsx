import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import type { DashboardSnapshot } from '#/lib/token-analytics'
import {
  formatDayShort,
  formatModelLabel,
  toPolylinePoints,
} from '#/lib/dashboard-view'

export type LegendItem = {
  color: string
  label: string
}

type ChartCardProps = {
  children: ReactNode
  footer?: ReactNode
  legend?: LegendItem[]
  title: string
}

type LegendStatsProps = {
  items: Array<{
    accent: string
    key: string
    label: string
    value: string
  }>
}

type TrafficBarsProps = {
  data: DashboardSnapshot['charts']['requestsCostCache']
}

type LineChartProps = {
  data: DashboardSnapshot['charts']['inputOutput']
  title: string
}

type ModelBarsProps = {
  data: DashboardSnapshot['charts']['models']
  valueKey: 'requests' | 'tokens'
}

type TokenBarsProps = {
  data: DashboardSnapshot['charts']['tokenVolume']
}

type CostBarsProps = {
  data: DashboardSnapshot['charts']['costByDay']
}

export function ChartCard({ children, footer, legend, title }: ChartCardProps) {
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

export function LegendStats({ items }: LegendStatsProps) {
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

export function TrafficBars({ data }: TrafficBarsProps) {
  const maxRequests = Math.max(...data.map((item) => item.primary), 1)

  return (
    <div className="chart-block chart-block-bars">
      {data.map((item) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack">
            <span
              className="bar bar-grey"
              style={{ height: `${(item.primary / maxRequests) * 100}%` }}
            />
            <span
              className="bar bar-red"
              style={{ height: `${Math.max(item.secondary, 8)}px` }}
            />
            <span
              className="bar bar-violet"
              style={{ height: `${Math.max(item.tertiary, 8)}%` }}
            />
          </div>
          <span className="chart-label">{formatDayShort(item.day)}</span>
        </div>
      ))}
    </div>
  )
}

export function LineChart({ data, title }: LineChartProps) {
  const primary = toPolylinePoints(data.map((item) => item.primary))
  const secondary = toPolylinePoints(data.map((item) => item.secondary))

  return (
    <svg className="line-chart" viewBox="0 0 320 150" role="img">
      <title>{title}</title>
      <line className="chart-axis" x1="16" x2="304" y1="130" y2="130" />
      <line className="chart-gridline" x1="16" x2="304" y1="92" y2="92" />
      <line className="chart-gridline" x1="16" x2="304" y1="54" y2="54" />
      <polyline className="chart-line chart-line-muted" points={primary} />
      <polyline className="chart-line" points={secondary} />
    </svg>
  )
}

export function ModelBars({ data, valueKey }: ModelBarsProps) {
  const maxValue = Math.max(...data.map((item) => item[valueKey]), 1)

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div
          className="bar-group"
          key={`${item.provider}:${item.model}:${valueKey}`}
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
          <span className="chart-label chart-label-wide">
            {formatModelLabel(item.model, item.provider)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function TokenBars({ data }: TokenBarsProps) {
  const maxTokens = Math.max(
    ...data.map((item) => item.inputTokens + item.outputTokens),
    1,
  )

  return (
    <div className="chart-block chart-block-bars">
      {data.map((item) => {
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
            <span className="chart-label">{formatDayShort(item.day)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function CostBars({ data }: CostBarsProps) {
  const maxCost = Math.max(...data.map((item) => item.cost), 1)

  return (
    <div className="chart-block chart-block-bars chart-block-thick">
      {data.map((item) => (
        <div className="bar-group" key={item.day}>
          <div className="bar-stack bar-stack-wide">
            <span
              className="bar bar-magenta"
              style={{ height: `${(item.cost / maxCost) * 100}%` }}
            />
          </div>
          <span className="chart-label chart-label-wide">
            {formatDayShort(item.day)}
          </span>
        </div>
      ))}
    </div>
  )
}

function LegendRow({ items }: { items: LegendItem[] }) {
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
