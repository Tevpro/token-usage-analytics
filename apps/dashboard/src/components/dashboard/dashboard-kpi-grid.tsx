import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import type { DashboardSnapshot } from '#/lib/token-analytics'

const toneClassNameMap = {
  negative: 'text-rose-600',
  neutral: 'text-slate-500',
  positive: 'text-emerald-600',
  warning: 'text-amber-600',
} as const

type DashboardKpiGridProps = {
  kpis: DashboardSnapshot['kpis']
  sourceLabel: string
}

export function DashboardKpiGrid({ kpis, sourceLabel }: DashboardKpiGridProps) {
  return (
    <section className="kpi-grid">
      {kpis.map((kpi) => (
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
              {sourceLabel}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
