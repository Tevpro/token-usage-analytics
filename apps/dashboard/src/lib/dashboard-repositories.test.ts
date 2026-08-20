import { expect, it } from 'vitest'

import { filterSnapshotByRepositories } from '#/lib/dashboard-repositories'
import { buildSnapshotFromRollups } from '#/lib/token-analytics'

function buildPricedSnapshot() {
  return buildSnapshotFromRollups({
    dailyRows: [
      {
        actualCostObservedSessions: 1,
        actualCostObservedTokens: 100,
        actualCostUsd: 0.75,
        cachedTokens: 10,
        cost: 1,
        day: '2026-05-24',
        inputTokens: 70,
        outputTokens: 20,
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        requests: 2,
        totalTokens: 100,
      },
    ],
    environment: 'production',
    generatedAt: '2026-05-24T00:00:00Z',
    issues: [],
    modelRowsByDay: [
      {
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        cost: 1,
        day: '2026-05-24',
        inputTokens: 70,
        model: 'gpt-5.4',
        outputTokens: 20,
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        provider: 'OpenAI',
        reasoningTokens: 0,
        requests: 2,
        tokens: 100,
      },
    ],
    models: [
      {
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        cost: 1,
        inputTokens: 70,
        model: 'gpt-5.4',
        outputTokens: 20,
        provider: 'OpenAI',
        reasoningTokens: 0,
        requests: 2,
        tokens: 100,
      },
    ],
    publicPricing: {
      availability: 'available',
      rates: [
        {
          cacheReadMicroUsdPerMtok: 500_000,
          cacheWriteMicroUsdPerMtok: 0,
          effectiveDay: '2026-05-24',
          fetchedAt: 1,
          inputMicroUsdPerMtok: 2_000_000,
          outputMicroUsdPerMtok: 8_000_000,
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
    repositoryModelRows: [
      {
        attributionStatus: 'exact',
        cost: 1,
        day: '2026-05-24',
        model: 'gpt-5.4',
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        provider: 'OpenAI',
        repositoryId: 'repo:atlas',
        requests: 2,
        tokens: 100,
      },
    ],
    repositoryRows: [
      {
        attributionStatus: 'exact',
        cachedTokens: 10,
        cost: 1,
        day: '2026-05-24',
        inputTokens: 70,
        outputTokens: 20,
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        repositoryId: 'repo:atlas',
        repositoryKey: 'github.com/org/atlas',
        repositoryName: 'atlas',
        requests: 2,
        totalTokens: 100,
      },
    ],
    sourceLabel: 'Hermes',
  })
}

it('preserves pricing and actual-cost dimensions when no repository is selected', () => {
  const snapshot = buildPricedSnapshot()
  const filtered = filterSnapshotByRepositories(snapshot, [])

  expect(filtered).toBe(snapshot)
  expect(filtered.pricing).toEqual(snapshot.pricing)
  expect(filtered.actualCost).toEqual(snapshot.actualCost)
  expect(filtered.filters.publicPricing).toBe(snapshot.filters.publicPricing)
})

it('keeps global pricing metadata without inventing repository cost dimensions', () => {
  const snapshot = buildPricedSnapshot()

  const filtered = filterSnapshotByRepositories(snapshot, ['repo:atlas'])

  expect(filtered.filters.publicPricing).toBe(snapshot.filters.publicPricing)
  expect(filtered.pricing).toMatchObject({
    availability: 'available',
    coveredTokens: 0,
    coverageRatio: 0,
    projectedCostMicroUsd: null,
    sourceUrl: 'https://pricing.example/catalog.json',
    totalTokens: 100,
    unpricedModels: ['gpt-5.4'],
  })
  expect(filtered.actualCost).toEqual({
    coverageRatio: 0,
    observedSessions: 0,
    observedTokens: 0,
    reportedCostUsd: null,
    totalTokens: 100,
  })
  expect(filtered.charts.models[0]).toMatchObject({
    model: 'gpt-5.4',
    tokens: 100,
  })
  expect(filtered.charts.models[0]).not.toHaveProperty('cacheReadTokens')
  expect(filtered.charts.models[0]).not.toHaveProperty('inputTokens')
  expect(filtered.charts.models[0]).not.toHaveProperty('outputTokens')
})

it('filters daily and model usage by repository while retaining unattributed coverage', () => {
  const snapshot = buildSnapshotFromRollups({
    dailyRows: [],
    environment: 'production',
    generatedAt: '2026-05-24T00:00:00Z',
    issues: [],
    models: [],
    sourceLabel: 'Hermes',
    repositoryRows: [
      {
        attributionStatus: 'exact',
        cachedTokens: 10,
        cost: 1,
        day: '2026-05-24',
        inputTokens: 70,
        outputTokens: 20,
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        repositoryId: 'repo:atlas',
        repositoryKey: 'github.com/org/atlas',
        repositoryName: 'atlas',
        requests: 2,
        totalTokens: 100,
      },
      {
        attributionStatus: 'unknown',
        cachedTokens: 0,
        cost: 0.5,
        day: '2026-05-24',
        inputTokens: 40,
        outputTokens: 10,
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        repositoryId: 'unattributed',
        repositoryKey: 'unattributed',
        repositoryName: 'Unattributed',
        requests: 1,
        totalTokens: 50,
      },
    ],
    repositoryModelRows: [
      {
        attributionStatus: 'exact',
        cost: 1,
        day: '2026-05-24',
        model: 'gpt-5.4',
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        provider: 'Hermes',
        repositoryId: 'repo:atlas',
        requests: 2,
        tokens: 100,
      },
      {
        attributionStatus: 'unknown',
        cost: 0.5,
        day: '2026-05-24',
        model: 'gpt-4.1',
        projectId: 'workspace:a',
        projectName: 'Agent',
        projectProvider: 'Hermes',
        projectSlug: 'a',
        provider: 'Hermes',
        repositoryId: 'unattributed',
        requests: 1,
        tokens: 50,
      },
    ],
  })

  expect(
    snapshot.repositories.breakdown.map((row) => row.repositoryName),
  ).toEqual(['atlas', 'Unattributed'])
  expect(snapshot.repositories.attributionCoverage).toBeCloseTo(2 / 3)
  const filtered = filterSnapshotByRepositories(snapshot, ['repo:atlas'])
  expect(filtered.table[0]).toMatchObject({ requests: 2, totalTokens: 100 })
  expect(filtered.charts.models.map((row) => row.model)).toEqual(['gpt-5.4'])
  expect(filtered.repositories.selected).toEqual(['repo:atlas'])
  expect(filtered.repositories.attributionCoverage).toBeCloseTo(2 / 3)
})
