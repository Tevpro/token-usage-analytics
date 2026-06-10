import { describe, expect, it } from 'vitest'

import { buildSnapshotFromRollups, calculateCachedShare, resolveTotalInputTokens } from '#/lib/token-analytics'

describe('token analytics cache calculations', () => {
  it('derives total input tokens from total minus output when cached tokens are stored separately', () => {
    const row = {
      cachedTokens: 900,
      cost: 2.75,
      day: '2026-05-24',
      inputTokens: 100,
      outputTokens: 50,
      projectId: 'workspace:atlas',
      projectName: 'Atlas',
      projectProvider: 'Hermes',
      projectSlug: 'atlas',
      requests: 12,
      totalTokens: 1050,
    }

    expect(resolveTotalInputTokens(row)).toBe(1000)
    expect(calculateCachedShare(row)).toBe(0.9)

    const snapshot = buildSnapshotFromRollups({
      dailyRows: [row],
      environment: 'production',
      generatedAt: '2026-05-24T13:02:00Z',
      issues: [],
      models: [{ cost: 2.75, model: 'gpt-5.4', provider: 'Hermes', requests: 12, tokens: 1050 }],
      sourceLabel: 'Live Hermes data',
      workspaceName: 'Atlas',
    })

    expect(snapshot.kpis.find((item) => item.label === 'Cached Input Share')?.value).toBe('90.0%')
    expect(snapshot.table[0]).toMatchObject({
      cachedShare: 0.9,
      inputTokens: 1000,
    })
    expect(snapshot.charts.inputOutput[0]?.primary).toBe(1000)
    expect(snapshot.charts.requestsCostCache[0]?.tertiary).toBe(90)
    expect(snapshot.charts.tokenVolume[0]?.inputTokens).toBe(1000)
  })

  it('does not double count cached tokens when input is already inclusive', () => {
    const row = {
      cachedTokens: 200,
      cost: 1.25,
      day: '2026-05-24',
      inputTokens: 1000,
      outputTokens: 300,
      projectId: 'workspace:atlas',
      projectName: 'Atlas',
      projectProvider: 'Hermes',
      projectSlug: 'atlas',
      requests: 8,
      totalTokens: 1300,
    }

    expect(resolveTotalInputTokens(row)).toBe(1000)
    expect(calculateCachedShare(row)).toBe(0.2)
  })

  it('aggregates daily totals while preserving per-project breakdowns', () => {
    const snapshot = buildSnapshotFromRollups({
      dailyRows: [
        {
          cachedTokens: 100,
          cost: 1.5,
          day: '2026-05-24',
          inputTokens: 400,
          outputTokens: 200,
          projectId: 'workspace:atlas',
          projectName: 'Atlas',
          projectProvider: 'Hermes',
          projectSlug: 'atlas',
          requests: 6,
          totalTokens: 600,
        },
        {
          cachedTokens: 60,
          cost: 0.75,
          day: '2026-05-24',
          inputTokens: 300,
          outputTokens: 100,
          projectId: 'workspace:zeus',
          projectName: 'Zeus',
          projectProvider: 'OpenAI',
          projectSlug: 'zeus',
          requests: 4,
          totalTokens: 400,
        },
      ],
      environment: 'production',
      generatedAt: '2026-05-24T13:02:00Z',
      issues: [],
      models: [{ cost: 2.25, model: 'gpt-5.4', provider: 'Hermes', requests: 10, tokens: 1000 }],
      sourceLabel: 'Live multi-source data',
    })

    expect(snapshot.table).toHaveLength(1)
    expect(snapshot.table[0]).toMatchObject({
      cost: 2.25,
      requests: 10,
      totalTokens: 1000,
    })
    expect(snapshot.projects.available).toHaveLength(2)
    expect(snapshot.projects.breakdown).toEqual([
      expect.objectContaining({ projectName: 'Atlas', requests: 6, totalTokens: 600 }),
      expect.objectContaining({ projectName: 'Zeus', requests: 4, totalTokens: 400 }),
    ])
    expect(snapshot.headline.workspace).toBe('All projects')
  })

  it('fills missing daily buckets through the requested window end with zeros', () => {
    const snapshot = buildSnapshotFromRollups({
      bucketWindowEnd: '2026-05-26T12:00:00Z',
      dailyRows: [
        {
          cachedTokens: 100,
          cost: 1.5,
          day: '2026-05-24',
          inputTokens: 400,
          outputTokens: 200,
          projectId: 'workspace:atlas',
          projectName: 'Atlas',
          projectProvider: 'Hermes',
          projectSlug: 'atlas',
          requests: 6,
          totalTokens: 600,
        },
      ],
      environment: 'production',
      generatedAt: '2026-05-24T13:02:00Z',
      issues: [],
      models: [{ cost: 1.5, model: 'gpt-5.4', provider: 'Hermes', requests: 6, tokens: 600 }],
      sourceLabel: 'Live Hermes data',
      workspaceName: 'Atlas',
    })

    expect(snapshot.filters.availableEndDay).toBe('2026-05-26')
    expect(snapshot.table.map((row) => row.day)).toEqual(['2026-05-24', '2026-05-25', '2026-05-26'])
    expect(snapshot.table[1]).toMatchObject({ cost: 0, day: '2026-05-25', requests: 0, totalTokens: 0 })
    expect(snapshot.table[2]).toMatchObject({ cost: 0, day: '2026-05-26', requests: 0, totalTokens: 0 })
  })
})
