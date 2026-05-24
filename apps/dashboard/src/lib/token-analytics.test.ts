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
      workspaceName: 'Hermes Usage',
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
      requests: 8,
      totalTokens: 1300,
    }

    expect(resolveTotalInputTokens(row)).toBe(1000)
    expect(calculateCachedShare(row)).toBe(0.2)
  })
})
