import { describe, expect, it } from 'vitest'

import { filterSnapshotByTimeframe, resolveTimeframeSelection } from '#/lib/dashboard-timeframe'
import { buildSnapshotFromRollups } from '#/lib/token-analytics'

const snapshot = buildSnapshotFromRollups({
  dailyRows: [
    { cachedTokens: 120, cost: 1.25, day: '2026-05-01', inputTokens: 1000, outputTokens: 400, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', requests: 10, totalTokens: 1400 },
    { cachedTokens: 240, cost: 2.5, day: '2026-05-02', inputTokens: 2000, outputTokens: 800, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', requests: 20, totalTokens: 2800 },
    { cachedTokens: 360, cost: 3.75, day: '2026-05-03', inputTokens: 3000, outputTokens: 1200, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', requests: 30, totalTokens: 4200 },
  ],
  environment: 'production',
  generatedAt: '2026-05-03T12:00:00Z',
  issues: [
    { count: 2, severity: 'high', title: 'Spend spike' },
    { count: 1, severity: 'low', title: 'Cache healthy' },
  ],
  issuesByDay: [
    { count: 1, day: '2026-05-02', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', severity: 'high', title: 'Spend spike' },
    { count: 1, day: '2026-05-03', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', severity: 'high', title: 'Spend spike' },
    { count: 1, day: '2026-05-01', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', severity: 'low', title: 'Cache healthy' },
  ],
  models: [
    { cost: 4.5, model: 'gpt-5.4', provider: 'Hermes', requests: 45, tokens: 6200 },
    { cost: 3, model: 'claude-sonnet', provider: 'Hermes', requests: 15, tokens: 2200 },
  ],
  modelRowsByDay: [
    { cost: 1.5, day: '2026-05-01', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 10, tokens: 1400 },
    { cost: 0.5, day: '2026-05-01', model: 'claude-sonnet', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 3, tokens: 500 },
    { cost: 1.5, day: '2026-05-02', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 15, tokens: 2200 },
    { cost: 1, day: '2026-05-02', model: 'claude-sonnet', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 5, tokens: 700 },
    { cost: 1.5, day: '2026-05-03', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 20, tokens: 2600 },
    { cost: 1.5, day: '2026-05-03', model: 'claude-sonnet', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Hermes', requests: 7, tokens: 1000 },
  ],
  sourceLabel: 'Hermes plugin sync',
  workspaceName: 'Hermes Usage',
})

describe('dashboard timeframe filtering', () => {
  it('filters a custom date window and recomputes totals, models, and issues', () => {
    const filtered = filterSnapshotByTimeframe(snapshot, {
      endDay: '2026-05-03',
      preset: 'custom',
      startDay: '2026-05-02',
    })

    expect(filtered.headline.rangeLabel).toBe('May 2, 2026 to May 3, 2026')
    expect(filtered.kpis.find((item) => item.label === 'API Calls')?.value).toBe('50')
    expect(filtered.table.map((row) => row.day)).toEqual(['2026-05-02', '2026-05-03'])
    expect(filtered.charts.models[0]).toMatchObject({ model: 'gpt-5.4', requests: 35, tokens: 4800 })
    expect(filtered.issues).toEqual([{ count: 2, severity: 'high', title: 'Spend spike' }])
  })

  it('clamps relative presets to the available bounds', () => {
    const resolved = resolveTimeframeSelection(snapshot, {
      endDay: '2026-05-03',
      preset: '7d',
    })

    expect(resolved).toEqual({
      endDay: '2026-05-03',
      preset: '7d',
      rangeLabel: 'Last 7 days',
      startDay: '2026-05-01',
    })
  })

  it('reorders an inverted custom range before filtering', () => {
    const filtered = filterSnapshotByTimeframe(snapshot, {
      endDay: '2026-05-01',
      preset: 'custom',
      startDay: '2026-05-03',
    })

    expect(filtered.table.map((row) => row.day)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('keeps same-named models from different providers separate after filtering', () => {
    const providerSplitSnapshot = buildSnapshotFromRollups({
      dailyRows: [
        { cachedTokens: 90, cost: 1.2, day: '2026-05-01', inputTokens: 900, outputTokens: 300, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', requests: 9, totalTokens: 1200 },
        { cachedTokens: 120, cost: 1.6, day: '2026-05-02', inputTokens: 1200, outputTokens: 400, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', requests: 12, totalTokens: 1600 },
      ],
      environment: 'production',
      generatedAt: '2026-05-02T12:00:00Z',
      issues: [],
      modelRowsByDay: [
        { cost: 0.6, day: '2026-05-01', model: 'claude-sonnet-4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'OpenRouter', requests: 5, tokens: 700 },
        { cost: 0.6, day: '2026-05-01', model: 'claude-sonnet-4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Anthropic', requests: 4, tokens: 500 },
        { cost: 0.8, day: '2026-05-02', model: 'claude-sonnet-4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'OpenRouter', requests: 7, tokens: 900 },
        { cost: 0.8, day: '2026-05-02', model: 'claude-sonnet-4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'Hermes', projectSlug: 'atlas', provider: 'Anthropic', requests: 5, tokens: 700 },
      ],
      models: [
        { cost: 1.4, model: 'claude-sonnet-4', provider: 'OpenRouter', requests: 12, tokens: 1600 },
        { cost: 1.4, model: 'claude-sonnet-4', provider: 'Anthropic', requests: 9, tokens: 1200 },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspaceName: 'Hermes Usage',
    })

    const filtered = filterSnapshotByTimeframe(providerSplitSnapshot, {
      endDay: '2026-05-02',
      preset: 'custom',
      startDay: '2026-05-01',
    })

    expect(filtered.charts.models).toHaveLength(2)
    expect(filtered.charts.models.map((item) => ({ model: item.model, provider: item.provider, requests: item.requests, tokens: item.tokens }))).toEqual([
      { model: 'claude-sonnet-4', provider: 'OpenRouter', requests: 12, tokens: 1600 },
      { model: 'claude-sonnet-4', provider: 'Anthropic', requests: 9, tokens: 1200 },
    ])
  })

  it('uses hourly buckets for the 24h preset when finer-grained rows are available', () => {
    const hourlySnapshot = buildSnapshotFromRollups({
      dailyRows: [
        { cachedTokens: 300, cost: 4.5, day: '2026-05-03', inputTokens: 3000, outputTokens: 1200, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', requests: 30, totalTokens: 4200 },
      ],
      environment: 'production',
      generatedAt: '2026-05-03T23:00:00Z',
      hourlyRows: [
        { cachedTokens: 40, cost: 0.6, day: '2026-05-03T20:00:00Z', inputTokens: 400, outputTokens: 180, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', requests: 4, totalTokens: 580 },
        { cachedTokens: 35, cost: 0.5, day: '2026-05-03T21:00:00Z', inputTokens: 350, outputTokens: 140, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', requests: 3, totalTokens: 490 },
        { cachedTokens: 45, cost: 0.7, day: '2026-05-03T22:00:00Z', inputTokens: 450, outputTokens: 210, projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', requests: 5, totalTokens: 660 },
      ],
      issues: [],
      models: [{ cost: 4.5, model: 'gpt-5.4', provider: 'OpenAI', requests: 30, tokens: 4200 }],
      modelRowsByDay: [
        { cost: 0.6, day: '2026-05-03T20:00:00Z', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', provider: 'OpenAI', requests: 4, tokens: 580 },
        { cost: 0.5, day: '2026-05-03T21:00:00Z', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', provider: 'OpenAI', requests: 3, tokens: 490 },
        { cost: 0.7, day: '2026-05-03T22:00:00Z', model: 'gpt-5.4', projectId: 'workspace:atlas', projectName: 'Atlas', projectProvider: 'OpenAI', projectSlug: 'atlas', provider: 'OpenAI', requests: 5, tokens: 660 },
      ],
      sourceLabel: 'Live OpenAI usage data',
      workspaceName: 'Atlas',
    })

    const filtered = filterSnapshotByTimeframe(hourlySnapshot, {
      endDay: '2026-05-03',
      preset: '24h',
    })

    expect(filtered.headline.granularity).toBe('hour')
    expect(filtered.table.map((row) => row.day)).toEqual([
      '2026-05-03T20:00:00Z',
      '2026-05-03T21:00:00Z',
      '2026-05-03T22:00:00Z',
    ])
    expect(filtered.kpis.find((item) => item.label === 'API Calls')?.value).toBe('12')
    expect(filtered.charts.models).toEqual([
      expect.objectContaining({ model: 'gpt-5.4', requests: 12, tokens: 1730 }),
    ])
  })
})
