import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_UPDATE_INTERVAL_MS,
  getAgentDataStatus,
  getAggregateAgentDataStatus,
} from '#/lib/dashboard-agent-status'

describe('getAgentDataStatus', () => {
  const now = new Date('2026-05-24T12:00:00Z')

  it('returns healthy when data arrived within the expected sync window', () => {
    const status = getAgentDataStatus('2026-05-24T11:50:00Z', {
      latestRollupDay: '2026-05-23',
      now,
    })

    expect(status).toEqual({
      detail: 'Receiving updates, last ingest 10m ago.',
      label: 'Receiving data',
      level: 'healthy',
    })
  })

  it('returns delayed after two missed expected sync windows', () => {
    const status = getAgentDataStatus('2026-05-24T11:20:00Z', {
      expectedUpdateIntervalMs: DEFAULT_AGENT_UPDATE_INTERVAL_MS,
      latestRollupDay: '2026-05-23',
      now,
    })

    expect(status).toEqual({
      detail: 'Last ingest 40m ago, beyond 2 expected sync windows.',
      label: 'Data delayed',
      level: 'delayed',
    })
  })

  it('returns stale after 24 hours without updates', () => {
    const status = getAgentDataStatus('2026-05-23T11:00:00Z', {
      latestRollupDay: '2026-05-23',
      now,
    })

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

  it('returns stale when ingest is fresh but the latest rollup day is more than one day behind', () => {
    const status = getAgentDataStatus('2026-06-01T13:47:00Z', {
      latestRollupDay: '2026-05-30',
      now: new Date('2026-06-01T14:00:00Z'),
    })

    expect(status).toEqual({
      detail: 'Last ingest 13m ago, but latest rollup date is 2026-05-30.',
      label: 'No recent data',
      level: 'stale',
    })
  })
})

describe('getAggregateAgentDataStatus', () => {
  const now = new Date('2026-06-12T17:00:00Z')

  it('stays healthy when all selected agents are receiving updates', () => {
    const status = getAggregateAgentDataStatus(
      [
        {
          latestGeneratedAt: '2026-06-12T16:55:00Z',
          latestRollupDay: '2026-06-12',
          projectName: 'Tevpro Hermes Usage',
        },
        {
          latestGeneratedAt: '2026-06-12T16:50:00Z',
          latestRollupDay: '2026-06-12',
          projectName: 'Tevpro Sales',
        },
      ],
      { now },
    )

    expect(status).toEqual({
      detail: 'All 2 selected agents are receiving updates.',
      label: 'Receiving data',
      level: 'healthy',
    })
  })

  it('turns delayed when only some selected agents are current', () => {
    const status = getAggregateAgentDataStatus(
      [
        {
          latestGeneratedAt: '2026-06-12T16:55:00Z',
          latestRollupDay: '2026-06-12',
          projectName: 'Tevpro Hermes Usage',
        },
        {
          latestGeneratedAt: '2026-06-12T15:00:00Z',
          latestRollupDay: '2026-06-12',
          projectName: 'Tevpro Sales',
        },
      ],
      { now },
    )

    expect(status).toEqual({
      detail: '1 of 2 selected agents need attention: Tevpro Sales.',
      label: 'Some agents delayed',
      level: 'delayed',
    })
  })

  it('turns stale when every selected agent is stale', () => {
    const status = getAggregateAgentDataStatus(
      [
        {
          latestGeneratedAt: '2026-06-10T12:00:00Z',
          latestRollupDay: '2026-06-10',
          projectName: 'Tevpro Hermes Usage',
        },
        {
          latestGeneratedAt: '2026-06-10T11:00:00Z',
          latestRollupDay: '2026-06-10',
          projectName: 'Tevpro Sales',
        },
      ],
      { now },
    )

    expect(status).toEqual({
      detail: 'None of the 2 selected agents have recent data.',
      label: 'No recent data',
      level: 'stale',
    })
  })
})
