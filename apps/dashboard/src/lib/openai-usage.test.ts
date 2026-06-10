import { afterEach, describe, expect, it, vi } from 'vitest'

import { filterSnapshotByTimeframe } from '#/lib/dashboard-timeframe'
import { ingestExternalRollupsToD1, loadDashboardSnapshotForRequest } from '#/lib/openai-usage'
import type { CloudflareAppEnv } from '#/lib/runtime'

type BoundStatement = {
  params: unknown[]
  sql: string
}

type WorkspaceRow = {
  createdAt: number
  id: string
  lastIngestedAt: number | null
  name: string
  provider: string
  slug: string
}

type DailyRollupStoredRow = {
  cachedTokens: number
  cost: number
  createdAt: number
  day: string
  environment: string
  id: string
  inputTokens: number
  outputTokens: number
  p95LatencyMs: number
  projectId: string
  requests: number
  totalTokens: number
}

type ModelUsageStoredRow = {
  cost: number
  id: string
  model: string
  provider: string
  requests: number
  rollupId: string
  tokens: number
}

afterEach(() => {
  vi.useRealTimers()
})

class FakePreparedStatement {
  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new FakePreparedStatement(this.db, this.sql, params)
  }

  async all<T>() {
    return { results: this.db.selectAll(this.sql, this.params) as T[] }
  }

  async run() {
    this.db.runs.push({ params: this.params, sql: this.sql })
    this.db.apply(this.sql, this.params)
    return { success: true }
  }
}

class FakeD1Database {
  runs: BoundStatement[] = []
  batches: BoundStatement[][] = []
  workspaces = new Map<string, WorkspaceRow>()
  dailyRollups: DailyRollupStoredRow[] = []
  modelDailyUsage: ModelUsageStoredRow[] = []

  prepare(sql: string) {
    return new FakePreparedStatement(this, sql)
  }

  async batch(statements: FakePreparedStatement[]) {
    const batch = statements.map((statement) => ({
      params: statement.params,
      sql: statement.sql,
    }))
    this.batches.push(batch)
    for (const statement of statements) {
      this.apply(statement.sql, statement.params)
    }
    return []
  }

  apply(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO workspaces')) {
      const [id, slug, name, provider, createdAt, lastIngestedAt] = params as [string, string, string, string, number, number | null]
      this.workspaces.set(id, { createdAt, id, lastIngestedAt, name, provider, slug })
      return
    }

    if (sql.includes('DELETE FROM daily_usage_rollups')) {
      const [workspaceId, startDay, endDay] = params as [string, string, string]
      const removedIds = new Set(
        this.dailyRollups
          .filter((row) => row.projectId === workspaceId && row.day >= startDay && row.day <= endDay)
          .map((row) => row.id),
      )
      this.dailyRollups = this.dailyRollups.filter((row) => !removedIds.has(row.id))
      this.modelDailyUsage = this.modelDailyUsage.filter((row) => !removedIds.has(row.rollupId))
      return
    }

    if (sql.includes('DELETE FROM issue_events')) {
      return
    }

    if (sql.includes('INSERT INTO daily_usage_rollups')) {
      const [id, workspaceId, day, environment, requests, totalTokens, inputTokens, outputTokens, cachedTokens, cost, , , p95LatencyMs, createdAt] =
        params as [string, string, string, string, number, number, number, number, number, number, number, number, number, number]
      this.dailyRollups.push({
        cachedTokens,
        cost,
        createdAt,
        day,
        environment,
        id,
        inputTokens,
        outputTokens,
        p95LatencyMs,
        projectId: workspaceId,
        requests,
        totalTokens,
      })
      return
    }

    if (sql.includes('INSERT INTO model_daily_usage')) {
      const [id, rollupId, model, provider, requests, tokens, cost] = params as [string, string, string, string, number, number, number]
      this.modelDailyUsage.push({ cost, id, model, provider, requests, rollupId, tokens })
    }
  }

  selectAll(sql: string, params: unknown[]) {
    if (sql.includes('COALESCE(workspaces.last_ingested_at')) {
      const [slug] = params as [string, string]
      return [...this.workspaces.values()]
        .map((workspace) => {
          const rollups = this.dailyRollups.filter((row) => row.projectId === workspace.id)
          const latestRollup = [...rollups].sort((left, right) => right.createdAt - left.createdAt)[0]
          const latestCreatedAt = workspace.lastIngestedAt ?? latestRollup?.createdAt ?? workspace.createdAt
          const latestDay = latestRollup?.day ?? null
          return {
            id: workspace.id,
            latestCreatedAt,
            latestDay,
            name: workspace.name,
            provider: workspace.provider,
            slug: workspace.slug,
          }
        })
        .sort((left, right) => {
          const leftPriority = slug && left.slug === slug ? 0 : 1
          const rightPriority = slug && right.slug === slug ? 0 : 1
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority
          }
          return right.latestCreatedAt - left.latestCreatedAt
        })
    }

    if (sql.includes('FROM daily_usage_rollups') && sql.includes('workspaces.name as projectName')) {
      const workspaceIds = params.slice(0, -1) as string[]
      const [startDay] = params.slice(-1) as [string]
      return this.dailyRollups
        .filter((row) => workspaceIds.includes(row.projectId) && row.day >= startDay)
        .map((row) => {
          const workspace = this.workspaces.get(row.projectId)!
          return {
            cachedTokens: row.cachedTokens,
            cost: row.cost,
            createdAt: row.createdAt,
            day: row.day,
            environment: row.environment,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            projectId: workspace.id,
            projectName: workspace.name,
            projectProvider: workspace.provider,
            projectSlug: workspace.slug,
            requests: row.requests,
            totalTokens: row.totalTokens,
          }
        })
        .sort((left, right) => left.day.localeCompare(right.day) || left.projectName.localeCompare(right.projectName))
    }

    if (sql.includes('SUM(model_daily_usage.requests) as requests')) {
      const workspaceIds = params.slice(0, -2) as string[]
      const [startDay, endDay] = params.slice(-2) as [string, string]
      const modelMap = new Map<string, { cost: number; model: string; provider: string; requests: number; tokens: number }>()

      for (const row of this.modelDailyUsage) {
        const rollup = this.dailyRollups.find((candidate) => candidate.id === row.rollupId)
        const rollupRangeValue = sql.includes('substr(daily_usage_rollups.usage_date, 1, 10)') ? rollup?.day.slice(0, 10) : rollup?.day
        if (!rollup || !rollupRangeValue || !workspaceIds.includes(rollup.projectId) || rollupRangeValue < startDay || rollupRangeValue > endDay) {
          continue
        }
        const key = `${row.provider}:${row.model}`
        const current = modelMap.get(key)
        if (current) {
          current.cost += row.cost
          current.requests += row.requests
          current.tokens += row.tokens
          continue
        }
        modelMap.set(key, { cost: row.cost, model: row.model, provider: row.provider, requests: row.requests, tokens: row.tokens })
      }

      return [...modelMap.values()].sort((left, right) => right.tokens - left.tokens)
    }

    if (sql.includes('FROM model_daily_usage') && sql.includes('daily_usage_rollups.usage_date as day')) {
      const workspaceIds = params.slice(0, -2) as string[]
      const [startDay, endDay] = params.slice(-2) as [string, string]
      return this.modelDailyUsage
        .flatMap((row) => {
          const rollup = this.dailyRollups.find((candidate) => candidate.id === row.rollupId)
          const rollupRangeValue = sql.includes('substr(daily_usage_rollups.usage_date, 1, 10)') ? rollup?.day.slice(0, 10) : rollup?.day
          if (!rollup || !rollupRangeValue || !workspaceIds.includes(rollup.projectId) || rollupRangeValue < startDay || rollupRangeValue > endDay) {
            return []
          }
          const workspace = this.workspaces.get(rollup.projectId)!
          return [{
            cost: row.cost,
            day: rollup.day,
            model: row.model,
            projectId: workspace.id,
            projectName: workspace.name,
            projectProvider: workspace.provider,
            projectSlug: workspace.slug,
            provider: row.provider,
            requests: row.requests,
            tokens: row.tokens,
          }]
        })
        .sort((left, right) => left.day.localeCompare(right.day) || right.tokens - left.tokens)
    }

    if (sql.includes('FROM issue_events')) {
      return []
    }

    return []
  }
}

describe('ingestExternalRollupsToD1', () => {
  it('writes external Hermes rollups and model usage into D1', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    const result = await ingestExternalRollupsToD1(env, {
      environment: 'production',
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [
        {
          cachedTokens: 150,
          estimatedCostUsd: 4.25,
          inputTokens: 1000,
          models: [
            {
              estimatedCostUsd: 4.25,
              model: 'gpt-5.4',
              provider: 'Hermes',
              requests: 12,
              tokens: 1600,
            },
          ],
          outputTokens: 450,
          requests: 12,
          totalTokens: 1600,
          usageDate: '2026-05-22',
        },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    })

    expect(result).toEqual({
      rowsWritten: 1,
      sourceLabel: 'Hermes plugin sync',
      syncedAt: '2026-05-23T12:00:00.000Z',
    })

    expect(db.runs).toHaveLength(1)
    expect(db.runs[0]?.sql).toContain('INSERT INTO workspaces')
    expect(db.runs[0]?.params).toEqual([
      'workspace:hermes-usage',
      'hermes-usage',
      'Hermes Usage',
      'Hermes',
      expect.any(Number),
      Date.parse('2026-05-23T12:00:00Z'),
    ])

    expect(db.batches).toHaveLength(2)
    expect(db.batches[0]?.map((statement) => statement.sql)).toEqual([
      'DELETE FROM issue_events WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
      'DELETE FROM daily_usage_rollups WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
    ])

    const insertBatch = db.batches[1] ?? []
    expect(insertBatch.some((statement) => statement.sql.includes('INSERT INTO daily_usage_rollups'))).toBe(true)
    expect(insertBatch.some((statement) => statement.sql.includes('INSERT INTO model_daily_usage'))).toBe(true)

    const rollupInsert = insertBatch.find((statement) => statement.sql.includes('INSERT INTO daily_usage_rollups'))
    expect(rollupInsert?.params).toEqual([
      'workspace:hermes-usage:2026-05-22',
      'workspace:hermes-usage',
      '2026-05-22',
      'production',
      12,
      1600,
      1000,
      450,
      150,
      4.25,
      0,
      0,
      0,
      Date.parse('2026-05-23T12:00:00Z'),
    ])
  })

  it('preserves Hermes hourly rollups through D1 loading into the 24h dashboard view', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await ingestExternalRollupsToD1(env, {
      environment: 'production',
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [
        {
          cachedTokens: 40,
          estimatedCostUsd: 0.9,
          inputTokens: 320,
          models: [
            {
              estimatedCostUsd: 0.9,
              model: 'gpt-5.4',
              provider: 'Hermes',
              requests: 5,
              tokens: 520,
            },
          ],
          outputTokens: 160,
          requests: 5,
          totalTokens: 520,
          usageDate: '2026-05-22T20:00:00Z',
        },
        {
          cachedTokens: 30,
          estimatedCostUsd: 0.7,
          inputTokens: 260,
          models: [
            {
              estimatedCostUsd: 0.7,
              model: 'claude-sonnet-4',
              provider: 'Hermes',
              requests: 4,
              tokens: 410,
            },
          ],
          outputTokens: 120,
          requests: 4,
          totalTokens: 410,
          usageDate: '2026-05-22T21:00:00Z',
        },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    })

    const result = await loadDashboardSnapshotForRequest(env)
    const snapshot = result.snapshot
    const filtered = filterSnapshotByTimeframe(snapshot, {
      endDay: snapshot.filters.availableEndDay,
      preset: '24h',
      startDay: snapshot.filters.availableStartDay,
    })

    expect(filtered.headline.granularity).toBe('hour')
    expect(filtered.charts.requestsCostCache).toHaveLength(24)
    expect(filtered.charts.requestsCostCache[0]).toEqual(
      expect.objectContaining({ day: '2026-05-22T13:00:00Z', primary: 0, secondary: 0, tertiary: 0 }),
    )
    expect(filtered.charts.requestsCostCache.at(-1)).toEqual(
      expect.objectContaining({ day: '2026-05-23T12:00:00Z', primary: 0, secondary: 0, tertiary: 0 }),
    )
    expect(
      filtered.charts.requestsCostCache
        .filter((item) => item.primary > 0)
        .map((item) => ({ day: item.day, primary: item.primary })),
    ).toEqual([
      { day: '2026-05-22T20:00:00Z', primary: 5 },
      { day: '2026-05-22T21:00:00Z', primary: 4 },
    ])
    expect(filtered.charts.models).toEqual([
      expect.objectContaining({ model: 'gpt-5.4', provider: 'Hermes', requests: 5, tokens: 520 }),
      expect.objectContaining({ model: 'claude-sonnet-4', provider: 'Hermes', requests: 4, tokens: 410 }),
    ])
  })

  it('accepts heartbeat-only payloads without rollups', async () => {
    const db = new FakeD1Database()
    const env = {
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await expect(
      ingestExternalRollupsToD1(env, {
        generatedAt: '2026-05-23T12:00:00Z',
        rollups: [],
        sourceLabel: 'Hermes heartbeat',
        workspace: {
          name: 'Hermes Usage',
          provider: 'Hermes',
          slug: 'hermes-usage',
        },
      }),
    ).resolves.toEqual({
      rowsWritten: 0,
      sourceLabel: 'Hermes heartbeat',
      syncedAt: '2026-05-23T12:00:00.000Z',
    })

    expect(db.runs).toHaveLength(1)
    expect(db.runs[0]?.params).toEqual([
      'workspace:hermes-usage',
      'hermes-usage',
      'Hermes Usage',
      'Hermes',
      expect.any(Number),
      Date.parse('2026-05-23T12:00:00Z'),
    ])
    expect(db.batches).toHaveLength(0)
  })

  it('builds a live zero-usage dashboard snapshot from heartbeat-only payloads', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await ingestExternalRollupsToD1(env, {
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [],
      sourceLabel: 'Hermes heartbeat',
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    })

    const result = await loadDashboardSnapshotForRequest(env)
    const snapshot = result.snapshot
    const filtered = filterSnapshotByTimeframe(snapshot, {
      endDay: snapshot.filters.availableEndDay,
      preset: '24h',
      startDay: snapshot.filters.availableStartDay,
    })

    expect(snapshot.headline.generatedAt).toBe('2026-05-23T12:00:00.000Z')
    expect(snapshot.headline.sourceLabel).toContain('Hermes data')
    expect(snapshot.headline.summary).toContain('Latest usage bucket: n/a.')
    expect(snapshot.projects.available).toEqual([
      expect.objectContaining({ projectName: 'Hermes Usage', projectSlug: 'hermes-usage' }),
    ])
    expect(filtered.headline.granularity).toBe('hour')
    expect(filtered.charts.requestsCostCache).toHaveLength(24)
    expect(filtered.charts.requestsCostCache[0]).toEqual(
      expect.objectContaining({ day: '2026-05-22T13:00:00Z', primary: 0, secondary: 0, tertiary: 0 }),
    )
    expect(filtered.charts.requestsCostCache.at(-1)).toEqual(
      expect.objectContaining({ day: '2026-05-23T12:00:00Z', primary: 0, secondary: 0, tertiary: 0 }),
    )
  })

  it('formats multi-project rollup summaries in Central time without D1 wording', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T15:12:00Z'))

    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await ingestExternalRollupsToD1(env, {
      environment: 'production',
      generatedAt: '2026-06-10T15:00:00Z',
      rollups: [
        {
          cachedTokens: 40,
          estimatedCostUsd: 0.9,
          inputTokens: 320,
          models: [],
          outputTokens: 160,
          requests: 5,
          totalTokens: 520,
          usageDate: '2026-06-10T15:00:00Z',
        },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    })

    await ingestExternalRollupsToD1(env, {
      environment: 'production',
      generatedAt: '2026-06-10T15:00:00Z',
      rollups: [
        {
          cachedTokens: 20,
          estimatedCostUsd: 0.4,
          inputTokens: 180,
          models: [],
          outputTokens: 90,
          requests: 2,
          totalTokens: 270,
          usageDate: '2026-06-10T14:00:00Z',
        },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspace: {
        name: 'Second Project',
        provider: 'Hermes',
        slug: 'second-project',
      },
    })

    const result = await loadDashboardSnapshotForRequest(env)
    expect(result.snapshot.headline.summary).toBe(
      '2 projects are contributing rollups. Last update 12m ago. Latest usage bucket: Jun 10, 2026, 10:00 AM CDT.',
    )
  })
})
