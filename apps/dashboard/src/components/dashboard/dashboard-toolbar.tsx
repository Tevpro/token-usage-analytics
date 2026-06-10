import { Bot, CalendarRange } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type {
  TimeframePreset,
  TimeframeSelection,
} from '#/lib/dashboard-timeframe'
import type { DashboardSnapshot } from '#/lib/token-analytics'
import {
  getProjectFilterSummary,
  toggleProjectSelection,
} from '#/lib/dashboard-view'

type DashboardToolbarProps = {
  availableEndDay: string
  availableProjects: DashboardSnapshot['projects']['available']
  availableStartDay: string
  onEndDayChange: (value: string) => void
  onPresetChange: (preset: TimeframePreset) => void
  onProjectChange: (projectIds: string[]) => void
  onStartDayChange: (value: string) => void
  selectedProjectIds: string[]
  timeframe: TimeframeSelection
}

export function DashboardToolbar({
  availableEndDay,
  availableProjects,
  availableStartDay,
  onEndDayChange,
  onPresetChange,
  onProjectChange,
  onStartDayChange,
  selectedProjectIds,
  timeframe,
}: DashboardToolbarProps) {
  return (
    <section className="dashboard-toolbar">
      <div className="toolbar-chip-group">
        <ProjectFilterChip
          availableProjects={availableProjects}
          onChange={onProjectChange}
          selectedProjectIds={selectedProjectIds}
        />
        <div className="toolbar-chip gap-3">
          <CalendarRange className="size-4" />
          <Select
            onValueChange={(value) => onPresetChange(value as TimeframePreset)}
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
              max={timeframe.endDay || availableEndDay}
              min={availableStartDay}
              onChange={(event) => onStartDayChange(event.target.value)}
              type="date"
              value={timeframe.startDay || availableStartDay}
            />
            <span className="text-slate-400">→</span>
            <Input
              aria-label="End date"
              className="h-8 w-[132px] border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              max={availableEndDay}
              min={timeframe.startDay || availableStartDay}
              onChange={(event) => onEndDayChange(event.target.value)}
              type="date"
              value={timeframe.endDay || availableEndDay}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ProjectFilterChip({
  availableProjects,
  onChange,
  selectedProjectIds,
}: {
  availableProjects: DashboardSnapshot['projects']['available']
  onChange: (projectIds: string[]) => void
  selectedProjectIds: string[]
}) {
  const selectedSet = new Set(selectedProjectIds)
  const selection = getProjectFilterSummary({
    availableProjects,
    selectedProjectIds,
  })

  return (
    <details className="relative">
      <summary className="toolbar-chip cursor-pointer list-none">
        <Bot className="size-4" />
        {selection.label}
        <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
          {selection.countLabel}
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
                  onChange={() =>
                    onChange(
                      toggleProjectSelection({
                        availableProjects,
                        projectId: project.projectId,
                        selectedProjectIds,
                      }),
                    )
                  }
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
