import { describe, expect, it } from 'vitest'

import { buildHomeView, formatDay, formatHoustonTimestamp, getDayDetail, getModelDetail, parseHomeSearch, toggleSortDirection } from '#/lib/dashboard-view'
import type { DashboardSnapshot } from '#/lib/token-analytics'

const snapshot = {
  callouts: ['gpt-4.1-mini carried the reload', 'cache rate held up'],
  charts: {
    costByDay: [
      { cost: 12, day: '2026-05-20' },
      { cost: 18, day: '2026-05-21' },
    ],
    inputOutput: [
      { day: '2026-05-20', primary: 100, secondary: 40 },
      { day: '2026-05-21', primary: 120, secondary: 45 },
    ],
    models: [
      { color: '#111', cost: 8, model: 'gpt-4.1-mini', provider: 'OpenAI', requests: 80, tokens: 800 },
      { color: '#222', cost: 4, model: 'gpt-4.1', provider: 'OpenAI', requests: 20, tokens: 200 },
    ],
    requestsCostCache: [
      { day: '2026-05-20', primary: 20, secondary: 3, tertiary: 55 },
      { day: '2026-05-21', primary: 40, secondary: 5, tertiary: 60 },
    ],
    tokenVolume: [
      { day: '2026-05-20', inputTokens: 60, outputTokens: 40 },
      { day: '2026-05-21', inputTokens: 75, outputTokens: 45 },
    ],
  },
  headline: {
    environment: 'production',
    generatedAt: '2026-05-21T12:00:00.000Z',
    rangeLabel: 'Last 2 days',
    sourceLabel: 'Cached OpenAI data',
    summary: 'Summary',
    workspace: 'Tevpro',
  },
  issues: [{ count: 2, severity: 'medium', title: 'Cost spike' }],
  kpis: [{ label: 'Requests', tone: 'positive', value: '100' }],
  table: [
    {
      cachedShare: 0.5,
      cost: 12,
      day: '2026-05-20',
      inputTokens: 60,
      outputTokens: 40,
      requests: 20,
      totalTokens: 100,
      traceId: 'workspace:2026-05-20',
    },
    {
      cachedShare: 0.6,
      cost: 18,
      day: '2026-05-21',
      inputTokens: 75,
      outputTokens: 45,
      requests: 40,
      totalTokens: 120,
      traceId: 'workspace:2026-05-21',
    },
  ],
} as DashboardSnapshot

describe('parseHomeSearch', () => {
  it('applies safe defaults', () => {
    expect(parseHomeSearch({})).toEqual({ dir: 'desc', page: 1, pageSize: 7, q: '', sort: 'day', tab: 'overview' })
  })

  it('normalizes allowed values', () => {
    expect(parseHomeSearch({ dir: 'asc', page: '2', pageSize: '10', q: '  gpt ', sort: 'cost', tab: 'models' })).toEqual({
      dir: 'asc',
      page: 2,
      pageSize: 10,
      q: 'gpt',
      sort: 'cost',
      tab: 'models',
    })
  })
})

describe('buildHomeView', () => {
  it('filters and sorts rows', () => {
    const dayView = buildHomeView(snapshot, parseHomeSearch({ q: '2026-05-21', sort: 'requests', dir: 'desc' }))
    expect(dayView.filteredTable).toHaveLength(1)
    expect(dayView.filteredTable[0]?.day).toBe('2026-05-21')

    const modelView = buildHomeView(snapshot, parseHomeSearch({ q: 'gpt', sort: 'requests', dir: 'desc' }))
    expect(modelView.filteredModels[0]?.model).toBe('gpt-4.1-mini')
  })
})

describe('detail helpers', () => {
  it('returns day detail with neighbors', () => {
    const detail = getDayDetail(snapshot, '2026-05-21')
    expect(detail?.row.cost).toBe(18)
    expect(detail?.previous?.day).toBe('2026-05-20')
  })

  it('returns model detail with shares', () => {
    const detail = getModelDetail(snapshot, 'gpt-4.1-mini')
    expect(detail?.rank).toBe(1)
    expect(detail?.shareOfRequests).toBeCloseTo(0.8)
  })
})

describe('toggleSortDirection', () => {
  it('toggles when the same key is selected', () => {
    const next = toggleSortDirection(parseHomeSearch({ sort: 'cost', dir: 'desc' }), 'cost')
    expect(next).toEqual({ dir: 'asc', sort: 'cost' })
  })
})


describe('date formatting', () => {
  it('formats daily labels in Houston local time without shifting the day', () => {
    expect(formatDay('2026-05-03')).toBe('May 3, 2026')
  })

  it('formats generated timestamps in Houston local time', () => {
    expect(formatHoustonTimestamp('2026-05-03T12:00:00Z')).toBe('May 3, 2026, 7:00 AM CDT')
  })
})
