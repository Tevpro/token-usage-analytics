import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_UPDATE_INTERVAL_MS, getAgentDataStatus } from '#/lib/dashboard-agent-status'

describe('getAgentDataStatus', () => {
  const now = new Date('2026-05-24T12:00:00Z')

  it('returns healthy when data arrived within the expected sync window', () => {
    const status = getAgentDataStatus('2026-05-24T11:50:00Z', { now })

    expect(status).toEqual({
      detail: 'Receiving updates, last ingest 10m ago.',
      label: 'Receiving data',
      level: 'healthy',
    })
  })

  it('returns delayed after two missed expected sync windows', () => {
    const status = getAgentDataStatus('2026-05-24T11:20:00Z', {
      expectedUpdateIntervalMs: DEFAULT_AGENT_UPDATE_INTERVAL_MS,
      now,
    })

    expect(status).toEqual({
      detail: 'Last ingest 40m ago, beyond 2 expected sync windows.',
      label: 'Data delayed',
      level: 'delayed',
    })
  })

  it('returns stale after 24 hours without updates', () => {
    const status = getAgentDataStatus('2026-05-23T11:00:00Z', { now })

    expect(status).toEqual({
      detail: 'Last ingest 1d 1h ago.',
      label: 'No recent data',
      level: 'stale',
    })
  })

  it('returns unknown when the timestamp is missing or invalid', () => {
    const status = getAgentDataStatus('', { now })

    expect(status).toEqual({
      detail: 'No ingest timestamp available yet.',
      label: 'Waiting for data',
      level: 'unknown',
    })
  })
})
