export type AgentDataStatus = {
  detail: string
  label: string
  level: 'healthy' | 'delayed' | 'stale' | 'unknown'
}

export type AgentStatusProject = {
  latestGeneratedAt?: string
  latestRollupDay?: string | null
  projectId?: string
  projectName?: string
}

export const DEFAULT_AGENT_UPDATE_INTERVAL_MS = 15 * 60 * 1000
const DELAYED_UPDATE_MULTIPLIER = 2
const MAX_ROLLUP_DAY_LAG_DAYS = 1
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function getAgentDataStatus(
  generatedAt: string,
  options?: {
    expectedUpdateIntervalMs?: number
    latestRollupDay?: string
    now?: Date
  },
): AgentDataStatus {
  const expectedUpdateIntervalMs = Math.max(options?.expectedUpdateIntervalMs || DEFAULT_AGENT_UPDATE_INTERVAL_MS, 1)
  const now = options?.now || new Date()
  const nowMs = now.getTime()
  const generatedAtMs = Date.parse(generatedAt)

  if (!Number.isFinite(generatedAtMs)) {
    return {
      detail: 'No ingest timestamp available yet.',
      label: 'Waiting for data',
      level: 'unknown',
    }
  }

  const ageMs = Math.max(0, nowMs - generatedAtMs)
  const latestRollupDay = options?.latestRollupDay?.trim()
  const latestRollupLagDays = latestRollupDay ? getUtcDayLag(latestRollupDay, now) : null

  if (latestRollupDay && latestRollupLagDays !== null && latestRollupLagDays > MAX_ROLLUP_DAY_LAG_DAYS) {
    return {
      detail: `Last ingest ${formatRelativeDuration(ageMs)} ago, but latest rollup date is ${latestRollupDay}.`,
      label: 'No recent data',
      level: 'stale',
    }
  }

  if (ageMs >= STALE_AFTER_MS) {
    return {
      detail: `Last ingest ${formatRelativeDuration(ageMs)} ago.`,
      label: 'No recent data',
      level: 'stale',
    }
  }

  if (ageMs > expectedUpdateIntervalMs * DELAYED_UPDATE_MULTIPLIER) {
    return {
      detail: `Last ingest ${formatRelativeDuration(ageMs)} ago, beyond 2 expected sync windows.`,
      label: 'Data delayed',
      level: 'delayed',
    }
  }

  return {
    detail: `Receiving updates, last ingest ${formatRelativeDuration(ageMs)} ago.`,
    label: 'Receiving data',
    level: 'healthy',
  }
}

export function getAggregateAgentDataStatus(
  projects: AgentStatusProject[],
  options?: {
    expectedUpdateIntervalMs?: number
    now?: Date
  },
): AgentDataStatus {
  if (projects.length === 0) {
    return getAgentDataStatus('', options)
  }

  if (projects.length === 1) {
    const [project] = projects
    return getAgentDataStatus(project?.latestGeneratedAt || '', {
      expectedUpdateIntervalMs: options?.expectedUpdateIntervalMs,
      latestRollupDay: project?.latestRollupDay || undefined,
      now: options?.now,
    })
  }

  const projectStatuses = projects.map((project) => ({
    name: project.projectName || project.projectId || 'Unknown agent',
    status: getAgentDataStatus(project.latestGeneratedAt || '', {
      expectedUpdateIntervalMs: options?.expectedUpdateIntervalMs,
      latestRollupDay: project.latestRollupDay || undefined,
      now: options?.now,
    }),
  }))
  const counts = projectStatuses.reduce(
    (accumulator, project) => {
      accumulator[project.status.level] += 1
      return accumulator
    },
    {
      delayed: 0,
      healthy: 0,
      stale: 0,
      unknown: 0,
    },
  )

  if (counts.healthy === projectStatuses.length) {
    return {
      detail: `All ${projectStatuses.length} selected agents are receiving updates.`,
      label: 'Receiving data',
      level: 'healthy',
    }
  }

  if (counts.stale === projectStatuses.length) {
    return {
      detail: `None of the ${projectStatuses.length} selected agents have recent data.`,
      label: 'No recent data',
      level: 'stale',
    }
  }

  if (counts.unknown === projectStatuses.length) {
    return {
      detail: `Waiting for the first ingest from all ${projectStatuses.length} selected agents.`,
      label: 'Waiting for data',
      level: 'unknown',
    }
  }

  const attentionProjects = projectStatuses.filter((project) => project.status.level !== 'healthy')
  const attentionNames = formatProjectNameList(attentionProjects.map((project) => project.name))

  return {
    detail: `${attentionProjects.length} of ${projectStatuses.length} selected agents need attention: ${attentionNames}.`,
    label: 'Some agents delayed',
    level: 'delayed',
  }
}

function getUtcDayLag(day: string, now: Date) {
  const normalizedDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
  if (!normalizedDay) {
    return null
  }

  const latestRollupMs = Date.parse(`${normalizedDay}T00:00:00Z`)
  if (!Number.isFinite(latestRollupMs)) {
    return null
  }

  const nowDayMs = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  return Math.max(0, Math.round((nowDayMs - latestRollupMs) / (24 * 60 * 60 * 1000)))
}

function formatRelativeDuration(valueMs: number) {
  const totalMinutes = Math.max(0, Math.round(valueMs / 60000))

  if (totalMinutes < 1) {
    return 'just now'
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours < 24) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`
}

function formatProjectNameList(names: string[]) {
  if (names.length === 0) {
    return 'none'
  }

  if (names.length <= 2) {
    return names.join(', ')
  }

  return `${names.slice(0, 2).join(', ')}, and ${names.length - 2} more`
}
