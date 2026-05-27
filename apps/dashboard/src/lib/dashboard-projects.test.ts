import { describe, expect, it } from 'vitest'

import { filterSnapshotByProjects } from '#/lib/dashboard-projects'
import { buildSnapshotFromRollups } from '#/lib/token-analytics'

const baseSnapshot = buildSnapshotFromRollups({
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
  models: [
    { cost: 1.5, model: 'gpt-5.4', provider: 'Hermes', requests: 6, tokens: 600 },
    { cost: 0.75, model: 'gpt-4.1-mini', provider: 'OpenAI', requests: 4, tokens: 400 },
  ],
  sourceLabel: 'Live multi-source project data',
})

describe('filterSnapshotByProjects', () => {
  it('keeps combined totals when all projects are selected implicitly', () => {
    const filtered = filterSnapshotByProjects(baseSnapshot, [])

    expect(filtered.headline.workspace).toBe('All projects')
    expect(filtered.table[0]).toMatchObject({ requests: 10, totalTokens: 1000 })
    expect(filtered.projects.breakdown).toHaveLength(2)
  })

  it('filters usage down to the requested project ids', () => {
    const filtered = filterSnapshotByProjects(baseSnapshot, ['workspace:atlas'])

    expect(filtered.headline.workspace).toBe('Atlas')
    expect(filtered.table[0]).toMatchObject({ cost: 1.5, requests: 6, totalTokens: 600 })
    expect(filtered.projects.breakdown).toEqual([
      expect.objectContaining({ projectId: 'workspace:atlas', projectName: 'Atlas', totalTokens: 600 }),
    ])
  })
})
