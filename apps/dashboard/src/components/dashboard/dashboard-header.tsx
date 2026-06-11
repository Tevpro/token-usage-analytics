import { RefreshCcw } from 'lucide-react'

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { AgentDataStatus } from '#/lib/dashboard-agent-status'

export type DashboardTab = 'overview' | 'models' | 'cost'

type DashboardHeaderProps = {
  activeTab: DashboardTab
  agentDataStatus: AgentDataStatus
  onRefresh: () => void
  onTabChange: (value: DashboardTab) => void
  sourceLabel: string
  summary: string
}

export function DashboardHeader({
  activeTab,
  agentDataStatus,
  onRefresh,
  onTabChange,
  sourceLabel,
  summary,
}: DashboardHeaderProps) {
  return (
    <section className="dashboard-header">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="dashboard-kicker">Token observability</p>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="dashboard-title">Token usage</h1>
              <p className="max-w-3xl text-sm text-slate-600">{summary}</p>
            </div>
            <div className="dashboard-header-actions">
              <Badge
                aria-label={`${sourceLabel}. ${agentDataStatus.detail}`}
                className={`dashboard-status-badge dashboard-status-${agentDataStatus.level}`}
                title={agentDataStatus.detail}
                variant="secondary"
              >
                <span aria-hidden className="dashboard-status-dot" />
                {sourceLabel}
              </Badge>
              <Button
                className="dashboard-feedback-button"
                onClick={onRefresh}
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
          onValueChange={(value) => onTabChange(value as DashboardTab)}
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
  )
}
