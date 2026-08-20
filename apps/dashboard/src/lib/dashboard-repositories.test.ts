import { expect, it } from 'vitest'

import { filterSnapshotByRepositories } from '#/lib/dashboard-repositories'
import { buildSnapshotFromRollups } from '#/lib/token-analytics'

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
