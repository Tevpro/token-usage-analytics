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

  it('distinguishes reported zero actual cost from missing actual cost', () => {
    const project = {
      projectId: 'workspace:atlas',
      projectName: 'Atlas',
      projectProvider: 'Hermes',
      projectSlug: 'atlas',
    }
    const snapshot = buildSnapshotFromRollups({
      dailyRows: [
        {
          ...project,
          actualCostObservedSessions: 0,
          actualCostObservedTokens: 0,
          actualCostUsd: null,
          cachedTokens: 0,
          cost: 1,
          day: '2026-08-19',
          inputTokens: 500,
          outputTokens: 0,
          requests: 1,
          totalTokens: 500,
        },
        {
          ...project,
          actualCostObservedSessions: 1,
          actualCostObservedTokens: 500,
          actualCostUsd: 0,
          cachedTokens: 0,
          cost: 1,
          day: '2026-08-20',
          inputTokens: 500,
          outputTokens: 0,
          requests: 1,
          totalTokens: 500,
        },
      ],
      environment: 'production',
      generatedAt: '2026-08-20T18:00:00Z',
      issues: [],
      models: [],
      sourceLabel: 'Live Hermes data',
    })

    expect(snapshot.actualCost).toEqual({
      coverageRatio: 0.5,
      observedSessions: 1,
      observedTokens: 500,
      reportedCostUsd: 0,
      totalTokens: 1_000,
    })
  })

  it('prices model rows with the rate effective on each day', () => {
    const project = {
      projectId: 'workspace:atlas',
      projectName: 'Atlas',
      projectProvider: 'Hermes',
      projectSlug: 'atlas',
    }
    const modelRowsByDay = ['2026-08-19', '2026-08-20'].map((day) => ({
      ...project,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      day,
      inputTokens: 1_000_000,
      model: 'gpt-5.4',
      outputTokens: 0,
      provider: 'OpenAI',
      reasoningTokens: 0,
      requests: 1,
      tokens: 1_000_000,
    }))

    const snapshot = buildSnapshotFromRollups({
      dailyRows: modelRowsByDay.map((row) => ({
        ...project,
        cachedTokens: 0,
        cost: 0,
        day: row.day,
        inputTokens: 1_000_000,
        outputTokens: 0,
        requests: 1,
        totalTokens: 1_000_000,
      })),
      environment: 'production',
      generatedAt: '2026-08-20T18:00:00Z',
      issues: [],
      modelRowsByDay,
      models: [
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          inputTokens: 2_000_000,
          model: 'gpt-5.4',
          outputTokens: 0,
          provider: 'OpenAI',
          reasoningTokens: 0,
          requests: 2,
          tokens: 2_000_000,
        },
      ],
      publicPricing: {
        availability: 'available',
        rates: [
          {
            cacheReadMicroUsdPerMtok: 0,
            cacheWriteMicroUsdPerMtok: 0,
            effectiveDay: '2026-08-19',
            fetchedAt: 1,
            inputMicroUsdPerMtok: 2_000_000,
            outputMicroUsdPerMtok: 0,
            priceKey: 'openai:gpt-5.4',
            requestedModel: 'gpt-5.4',
            requestedProvider: 'OpenAI',
            resolved: true,
            sourceModel: 'gpt-5.4',
            sourceProvider: 'openai',
            sourceUrl: 'https://pricing.example/catalog.json',
          },
          {
            cacheReadMicroUsdPerMtok: 0,
            cacheWriteMicroUsdPerMtok: 0,
            effectiveDay: '2026-08-20',
            fetchedAt: 2,
            inputMicroUsdPerMtok: 3_000_000,
            outputMicroUsdPerMtok: 0,
            priceKey: 'openai:gpt-5.4',
            requestedModel: 'gpt-5.4',
            requestedProvider: 'OpenAI',
            resolved: true,
            sourceModel: 'gpt-5.4',
            sourceProvider: 'openai',
            sourceUrl: 'https://pricing.example/catalog.json',
          },
        ],
        sourceUrl: 'https://pricing.example/catalog.json',
      },
      sourceLabel: 'Live Hermes data',
    })

    expect(snapshot.pricing.projectedCostMicroUsd).toBe(5_000_000)
    expect(snapshot.pricing.coveredTokens).toBe(2_000_000)
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
})
