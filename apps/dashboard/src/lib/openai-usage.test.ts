import { afterEach, describe, expect, it, vi } from 'vitest'

import { filterSnapshotByTimeframe } from '#/lib/dashboard-timeframe'
import {
  ingestExternalRollupsToD1,
  loadDashboardSnapshotForRequest,
  syncOpenAiUsageToD1,
} from '#/lib/openai-usage'
import type { ExternalIngestPayload } from '#/lib/openai-usage'
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
  actualCostObservedSessions?: number
  actualCostObservedTokens?: number
  actualCostUsd?: number | null
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
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  id: string
  inputTokens: number
  model: string
  outputTokens: number
  provider: string
  reasoningTokens: number
  requests: number
  rollupId: string
  tokens: number
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
    this.db.selects.push({ params: this.params, sql: this.sql })
    const results = this.db.selectAll(this.sql, this.params) as T[]
    this.db.afterStandaloneSelect?.(this.sql)
    return { results }
  }

  async run() {
    this.db.runs.push({ params: this.params, sql: this.sql })
    this.db.apply(this.sql, this.params)
    return { success: true }
  }
}

class FakeD1Database {
  runs: BoundStatement[] = []
  selects: BoundStatement[] = []
  batches: BoundStatement[][] = []
  workspaces = new Map<string, WorkspaceRow>()
  dailyRollups: DailyRollupStoredRow[] = []
  modelDailyUsage: ModelUsageStoredRow[] = []
  failOnSql?: string
  repositoryTablesExist = true
  afterStandaloneSelect?: (sql: string) => void

  constructor(
    readonly modelDimensionsAvailable = true,
    readonly actualCostAvailable = modelDimensionsAvailable,
  ) {}

  prepare(sql: string) {
    return new FakePreparedStatement(this, sql)
  }

  async batch(statements: FakePreparedStatement[]) {
    const batch = statements.map((statement) => ({
      params: statement.params,
      sql: statement.sql,
    }))
    this.batches.push(batch)
    const snapshot = structuredClone({
      dailyRollups: this.dailyRollups,
      modelDailyUsage: this.modelDailyUsage,
      workspaces: [...this.workspaces.entries()],
    })
    try {
      const results = []
      for (const statement of statements) {
        if (this.failOnSql && statement.sql.includes(this.failOnSql)) {
          throw new Error(`forced D1 failure: ${this.failOnSql}`)
        }
        if (statement.sql.trimStart().startsWith('SELECT')) {
          this.selects.push({ params: statement.params, sql: statement.sql })
          results.push({
            results: this.selectAll(statement.sql, statement.params),
          })
        } else {
          this.apply(statement.sql, statement.params)
          results.push({ success: true })
        }
      }
      return results
    } catch (error) {
      this.dailyRollups = snapshot.dailyRollups
      this.modelDailyUsage = snapshot.modelDailyUsage
      this.workspaces = new Map(snapshot.workspaces)
      throw error
    }
  }

  apply(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO workspaces')) {
      const [id, slug, name, provider, createdAt, lastIngestedAt] = params as [
        string,
        string,
        string,
        string,
        number,
        number | null,
      ]
      this.workspaces.set(id, {
        createdAt,
        id,
        lastIngestedAt,
        name,
        provider,
        slug,
      })
      return
    }

    if (sql.includes('DELETE FROM daily_usage_rollups')) {
      const [workspaceId, startDay, endDay] = params as [string, string, string]
      const removedIds = new Set(
        this.dailyRollups
          .filter(
            (row) =>
              row.projectId === workspaceId &&
              row.day >= startDay &&
              row.day <= endDay,
          )
          .map((row) => row.id),
      )
      this.dailyRollups = this.dailyRollups.filter(
        (row) => !removedIds.has(row.id),
      )
      this.modelDailyUsage = this.modelDailyUsage.filter(
        (row) => !removedIds.has(row.rollupId),
      )
      return
    }

    if (sql.includes('DELETE FROM issue_events')) {
      return
    }

    if (sql.includes('INSERT INTO daily_usage_rollups')) {
      const [
        id,
        workspaceId,
        day,
        environment,
        requests,
        totalTokens,
        inputTokens,
        outputTokens,
        cachedTokens,
        cost,
      ] = params as [
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      const modern = params.length === 17
      const actualCostUsd = modern ? (params[10] as number | null) : null
      const actualCostObservedSessions = modern ? (params[11] as number) : 0
      const actualCostObservedTokens = modern ? (params[12] as number) : 0
      const p95LatencyMs = params[modern ? 15 : 12] as number
      const createdAt = params[modern ? 16 : 13] as number
      this.dailyRollups.push({
        actualCostObservedSessions,
        actualCostObservedTokens,
        actualCostUsd,
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
      if (!this.modelDimensionsAvailable && sql.includes('input_tokens')) {
        throw new Error(
          'D1_ERROR: table model_daily_usage has no column named input_tokens',
        )
      }
      if (params.length === 7) {
        const [id, rollupId, model, provider, requests, tokens, cost] =
          params as [string, string, string, string, number, number, number]
        this.modelDailyUsage.push({
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost,
          id,
          inputTokens: 0,
          model,
          outputTokens: 0,
          provider,
          reasoningTokens: 0,
          requests,
          rollupId,
          tokens,
        })
        return
      }
      const [
        id,
        rollupId,
        model,
        provider,
        requests,
        tokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        cost,
      ] = params as [
        string,
        string,
        string,
        string,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
      this.modelDailyUsage.push({
        cacheReadTokens,
        cacheWriteTokens,
        cost,
        id,
        inputTokens,
        model,
        outputTokens,
        provider,
        reasoningTokens,
        requests,
        rollupId,
        tokens,
      })
    }
  }

  selectAll(sql: string, params: unknown[]): unknown[] {
    if (sql.includes('PRAGMA table_info(daily_usage_rollups)')) {
      return this.actualCostAvailable
        ? [
            { name: 'actual_cost_usd' },
            { name: 'actual_cost_observed_sessions' },
            { name: 'actual_cost_observed_tokens' },
          ]
        : [{ name: 'id' }, { name: 'estimated_cost_usd' }]
    }

    if (sql.includes('PRAGMA table_info(model_daily_usage)')) {
      return this.modelDimensionsAvailable
        ? [
            { name: 'input_tokens' },
            { name: 'output_tokens' },
            { name: 'cache_read_tokens' },
            { name: 'cache_write_tokens' },
            { name: 'reasoning_tokens' },
          ]
        : [{ name: 'id' }, { name: 'estimated_cost_usd' }]
    }

    if (
      !this.modelDimensionsAvailable &&
      sql.includes('model_daily_usage.input_tokens')
    ) {
      throw new Error(
        'D1_ERROR: no such column: model_daily_usage.input_tokens',
      )
    }

    if (
      sql.includes('sqlite_master') &&
      sql.includes('repository_daily_usage')
    ) {
      return this.repositoryTablesExist
        ? [{ name: 'repository_daily_usage' }]
        : []
    }
    if (sql.includes('COALESCE(workspaces.last_ingested_at')) {
      const [slug] = params as [string, string]
      return [...this.workspaces.values()]
        .map((workspace) => {
          const rollups = this.dailyRollups.filter(
            (row) => row.projectId === workspace.id,
          )
          const latestRollup = ([...rollups].sort(
            (left, right) => right.createdAt - left.createdAt,
          )[0] ?? null) as (typeof this.dailyRollups)[number] | null
          const latestCreatedAt =
            (workspace.lastIngestedAt as number | null | undefined) ??
            latestRollup?.createdAt ??
            workspace.createdAt
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

    if (
      sql.includes('FROM daily_usage_rollups') &&
      sql.includes('workspaces.name as projectName')
    ) {
      const hasEndDay = sql.includes('daily_usage_rollups.usage_date < ?')
      const workspaceIds = params.slice(0, hasEndDay ? -2 : -1) as string[]
      const [startDay, endDayExclusive] = hasEndDay
        ? (params.slice(-2) as [string, string])
        : ([params.at(-1), '9999-12-31'] as [string, string])
      return this.dailyRollups
        .filter(
          (row) =>
            workspaceIds.includes(row.projectId) &&
            row.day >= startDay &&
            row.day < endDayExclusive,
        )
        .map((row) => {
          const workspace = this.workspaces.get(row.projectId)!
          return {
            actualCostObservedSessions: row.actualCostObservedSessions,
            actualCostObservedTokens: row.actualCostObservedTokens,
            actualCostUsd: row.actualCostUsd,
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
        .sort(
          (left, right) =>
            left.day.localeCompare(right.day) ||
            left.projectName.localeCompare(right.projectName),
        )
    }

    if (sql.includes('SUM(model_daily_usage.requests) as requests')) {
      const workspaceIds = params.slice(0, -2) as string[]
      const [startDay, endDay] = params.slice(-2) as [string, string]
      const modelMap = new Map<string, ModelUsageStoredRow>()

      for (const row of this.modelDailyUsage) {
        const rollup = this.dailyRollups.find(
          (candidate) => candidate.id === row.rollupId,
        )
        const rollupRangeValue = sql.includes(
          'substr(daily_usage_rollups.usage_date, 1, 10)',
        )
          ? rollup?.day.slice(0, 10)
          : rollup?.day
        if (
          !rollup ||
          !rollupRangeValue ||
          !workspaceIds.includes(rollup.projectId) ||
          rollupRangeValue < startDay ||
          rollupRangeValue > endDay
        ) {
          continue
        }
        const key = `${row.provider}:${row.model}`
        const current = modelMap.get(key)
        if (current) {
          current.cost += row.cost
          current.inputTokens += row.inputTokens
          current.outputTokens += row.outputTokens
          current.cacheReadTokens += row.cacheReadTokens
          current.cacheWriteTokens += row.cacheWriteTokens
          current.reasoningTokens += row.reasoningTokens
          current.requests += row.requests
          current.tokens += row.tokens
          continue
        }
        modelMap.set(key, { ...row })
      }

      return [...modelMap.values()].sort(
        (left, right) => right.tokens - left.tokens,
      )
    }

    if (
      sql.includes('FROM model_daily_usage') &&
      sql.includes('daily_usage_rollups.usage_date as day')
    ) {
      const workspaceIds = params.slice(0, -2) as string[]
      const [startDay, endDay] = params.slice(-2) as [string, string]
      return this.modelDailyUsage
        .flatMap((row) => {
          const rollup = this.dailyRollups.find(
            (candidate) => candidate.id === row.rollupId,
          )
          const rollupRangeValue = sql.includes(
            'substr(daily_usage_rollups.usage_date, 1, 10)',
          )
            ? rollup?.day.slice(0, 10)
            : rollup?.day
          if (
            !rollup ||
            !rollupRangeValue ||
            !workspaceIds.includes(rollup.projectId) ||
            rollupRangeValue < startDay ||
            rollupRangeValue > endDay
          ) {
            return []
          }
          const workspace = this.workspaces.get(rollup.projectId)!
          return [
            {
              cacheReadTokens: row.cacheReadTokens,
              cacheWriteTokens: row.cacheWriteTokens,
              cost: row.cost,
              day: rollup.day,
              inputTokens: row.inputTokens,
              model: row.model,
              outputTokens: row.outputTokens,
              projectId: workspace.id,
              projectName: workspace.name,
              projectProvider: workspace.provider,
              projectSlug: workspace.slug,
              provider: row.provider,
              reasoningTokens: row.reasoningTokens,
              requests: row.requests,
              tokens: row.tokens,
            },
          ]
        })
        .sort(
          (left, right) =>
            left.day.localeCompare(right.day) || right.tokens - left.tokens,
        )
    }

    if (sql.includes('FROM public_model_pricing_daily')) {
      throw new Error('D1_ERROR: no such table: public_model_pricing_daily')
    }

    if (sql.includes('FROM issue_events')) {
      return []
    }

    return []
  }
}

function stubOpenAiUsage(empty = false) {
  const startTime = Math.floor(Date.parse('2026-05-22T00:00:00Z') / 1000)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.includes('/costs')
        ? {
            data: empty
              ? []
              : [
                  {
                    results: [{ amount: { value: 1.25 } }],
                    start_time: startTime,
                  },
                ],
          }
        : {
            data: empty
              ? []
              : [
                  {
                    results: [
                      {
                        input_cached_tokens: 10,
                        input_tokens: 80,
                        model: 'gpt-5.4',
                        num_model_requests: 2,
                        output_tokens: 20,
                      },
                    ],
                    start_time: startTime,
                  },
                ],
          }
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }),
  )
}

describe('syncOpenAiUsageToD1', () => {
  it('preserves the explicit empty native heartbeat write', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))
    stubOpenAiUsage(true)
    const db = new FakeD1Database()

    await expect(
      syncOpenAiUsageToD1({
        DB: db as unknown as D1Database,
        OPENAI_API_KEY: 'test-key',
      }),
    ).resolves.toMatchObject({ rowsWritten: 0 })

    expect(db.runs).toHaveLength(1)
    expect(db.batches).toHaveLength(0)
    expect(
      db.workspaces.get('workspace:openai-organization')?.lastIngestedAt,
    ).toBe(Date.parse('2026-05-23T12:00:00Z'))
  })

  it('syncs on a legacy schema without preparing repository statements', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))
    stubOpenAiUsage()
    const db = new FakeD1Database()
    db.repositoryTablesExist = false
    const originalPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      if (
        !sql.includes('sqlite_master') &&
        sql.includes('repository_daily_usage')
      ) {
        throw new Error('no such table: repository_daily_usage')
      }
      return originalPrepare(sql)
    }

    await expect(
      syncOpenAiUsageToD1({
        DB: db as unknown as D1Database,
        OPENAI_API_KEY: 'test-key',
      }),
    ).resolves.toMatchObject({ rowsWritten: 1 })
    expect(
      db.batches
        .flat()
        .some(({ sql }) => sql.includes('repository_daily_usage')),
    ).toBe(false)
  })

  it('atomically replaces native usage and workspace freshness', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))
    stubOpenAiUsage()
    const db = new FakeD1Database()
    const workspaceId = 'workspace:openai-organization'
    db.workspaces.set(workspaceId, {
      createdAt: 1,
      id: workspaceId,
      lastIngestedAt: 1,
      name: 'OpenAI Organization',
      provider: 'OpenAI',
      slug: 'openai-organization',
    })
    db.dailyRollups = [
      {
        cachedTokens: 0,
        cost: 0.5,
        createdAt: 1,
        day: '2026-05-22',
        environment: 'production',
        id: 'old-openai-rollup',
        inputTokens: 40,
        outputTokens: 10,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 1,
        totalTokens: 50,
      },
    ]
    db.failOnSql = 'INSERT INTO model_daily_usage'

    await expect(
      syncOpenAiUsageToD1({
        DB: db as unknown as D1Database,
        OPENAI_API_KEY: 'test-key',
      }),
    ).rejects.toThrow('forced D1 failure')

    expect(db.batches).toHaveLength(1)
    expect(db.batches[0]?.[0]?.sql).toContain('INSERT INTO workspaces')
    expect(db.dailyRollups.map((row) => row.id)).toEqual(['old-openai-rollup'])
    expect(db.workspaces.get(workspaceId)?.lastIngestedAt).toBe(1)
  })
})

describe('ingestExternalRollupsToD1', () => {
  it('requires repositoryRollups for every schema v2 payload before D1 mutation', async () => {
    const db = new FakeD1Database()

    await expect(
      ingestExternalRollupsToD1(
        { DB: db as unknown as D1Database },
        {
          schemaVersion: 2,
          rollups: [
            {
              inputTokens: 8,
              outputTokens: 2,
              requests: 1,
              usageDate: '2026-05-22',
            },
          ],
        },
      ),
    ).rejects.toThrow('schemaVersion 2 requires repositoryRollups')
    expect(db.runs).toHaveLength(0)
    expect(db.batches).toHaveLength(0)
  })

  it('rejects non-canonical or impossible usage buckets before destructive writes', async () => {
    for (const usageDate of [
      '2026-5-02',
      '2026-02-30',
      '2026-05-22T10:30:00Z',
      '2026-05-22T24:00:00Z',
    ]) {
      const db = new FakeD1Database()
      await expect(
        ingestExternalRollupsToD1(
          { DB: db as unknown as D1Database },
          {
            rollups: [
              { inputTokens: 8, outputTokens: 2, requests: 1, usageDate },
            ],
          },
        ),
      ).rejects.toThrow(`invalid usageDate: ${usageDate}`)
      expect(db.runs).toHaveLength(0)
      expect(db.batches).toHaveLength(0)
    }
  })

  it('accepts canonical UTC hour buckets', async () => {
    const db = new FakeD1Database()
    await ingestExternalRollupsToD1(
      { DB: db as unknown as D1Database },
      {
        rollups: [
          {
            inputTokens: 8,
            outputTokens: 2,
            requests: 1,
            usageDate: '2026-05-22T10:00:00Z',
          },
        ],
      },
    )
    expect(db.dailyRollups[0]?.day).toBe('2026-05-22T10:00:00Z')
  })

  it('batches workspace freshness with non-empty usage writes and rolls it back on failure', async () => {
    const db = new FakeD1Database()
    db.failOnSql = 'INSERT INTO daily_usage_rollups'

    await expect(
      ingestExternalRollupsToD1(
        { DB: db as unknown as D1Database },
        {
          generatedAt: '2026-05-23T12:00:00Z',
          rollups: [
            {
              inputTokens: 8,
              outputTokens: 2,
              requests: 1,
              usageDate: '2026-05-22',
            },
          ],
          workspace: { slug: 'atomic-agent' },
        },
      ),
    ).rejects.toThrow('forced D1 failure')

    expect(db.runs).toHaveLength(0)
    expect(db.batches).toHaveLength(1)
    expect(db.batches[0]?.[0]?.sql).toContain('INSERT INTO workspaces')
    expect(db.workspaces.has('workspace:atomic-agent')).toBe(false)
  })

  it('preserves empty payload heartbeat behavior without opening a usage batch', async () => {
    const db = new FakeD1Database()
    await ingestExternalRollupsToD1(
      { DB: db as unknown as D1Database },
      {
        generatedAt: '2026-05-23T12:00:00Z',
        rollups: [],
        workspace: { slug: 'heartbeat-agent' },
      },
    )
    expect(db.runs).toHaveLength(1)
    expect(db.batches).toHaveLength(0)
    expect(db.workspaces.get('workspace:heartbeat-agent')?.lastIngestedAt).toBe(
      Date.parse('2026-05-23T12:00:00Z'),
    )
  })

  it('invalidates stale repository usage when v1 replaces a v2 bucket', async () => {
    const db = new FakeD1Database()
    await ingestExternalRollupsToD1(
      { DB: db as unknown as D1Database },
      {
        rollups: [
          {
            inputTokens: 8,
            outputTokens: 2,
            requests: 1,
            usageDate: '2026-05-22',
          },
        ],
        workspace: { slug: 'legacy-agent' },
      },
    )
    expect(
      db.batches[0]?.some(({ sql }) =>
        sql.includes('DELETE FROM repository_daily_usage'),
      ),
    ).toBe(true)
  })

  it('accepts publisher four-decimal rounding drift during cost reconciliation', async () => {
    const db = new FakeD1Database()
    await expect(
      ingestExternalRollupsToD1(
        { DB: db as unknown as D1Database },
        {
          schemaVersion: 2,
          rollups: [
            {
              estimatedCostUsd: 0.0001,
              inputTokens: 2,
              outputTokens: 0,
              requests: 2,
              totalTokens: 2,
              usageDate: '2026-05-22',
            },
          ],
          repositoryRollups: [
            {
              attributionStatus: 'exact',
              estimatedCostUsd: 0.0001,
              inputTokens: 1,
              models: [
                {
                  estimatedCostUsd: 0.0001,
                  model: 'a',
                  requests: 1,
                  tokens: 1,
                },
              ],
              outputTokens: 0,
              repository: { key: 'github.com/org/a', name: 'a' },
              requests: 1,
              totalTokens: 1,
              usageDate: '2026-05-22',
            },
            {
              attributionStatus: 'exact',
              estimatedCostUsd: 0.0001,
              inputTokens: 1,
              models: [
                {
                  estimatedCostUsd: 0.0001,
                  model: 'b',
                  requests: 1,
                  tokens: 1,
                },
              ],
              outputTokens: 0,
              repository: { key: 'github.com/org/b', name: 'b' },
              requests: 1,
              totalTokens: 1,
              usageDate: '2026-05-22',
            },
          ],
        },
      ),
    ).resolves.toMatchObject({ rowsWritten: 1 })
  })

  it('validates repository reconciliation before destructive writes and ingests idempotently', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv
    const payload = {
      schemaVersion: 2,
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [
        {
          cachedTokens: 0,
          estimatedCostUsd: 1,
          inputTokens: 80,
          models: [
            {
              estimatedCostUsd: 1,
              model: 'gpt-5.4',
              requests: 2,
              tokens: 100,
            },
          ],
          outputTokens: 20,
          reasoningTokens: 0,
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      repositoryRollups: [
        {
          attributionStatus: 'exact' as const,
          cachedTokens: 0,
          estimatedCostUsd: 1,
          inputTokens: 80,
          models: [
            {
              estimatedCostUsd: 1,
              model: 'gpt-5.4',
              requests: 2,
              tokens: 100,
            },
          ],
          outputTokens: 20,
          reasoningTokens: 0,
          repository: { key: 'github.com/Tevpro/atlas', name: 'atlas' },
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      workspace: { slug: 'atlas-agent' },
    }

    await ingestExternalRollupsToD1(env, payload)
    await ingestExternalRollupsToD1(env, payload)

    const sql = db.batches
      .flat()
      .map((statement) => statement.sql)
      .join('\n')
    expect(sql).toContain('DELETE FROM repository_daily_usage')
    expect(sql).toContain('INSERT INTO repositories')
    expect(sql).toContain('INSERT INTO repository_daily_usage')
    expect(sql).toContain('INSERT INTO repository_model_daily_usage')

    const originalSelectAll = db.selectAll.bind(db)
    db.selectAll = (statementSql, params) => {
      if (
        statementSql.includes(
          'repository_daily_usage.total_tokens as totalTokens',
        )
      ) {
        return [
          {
            attributionStatus: 'exact',
            cachedTokens: 0,
            cost: 1,
            day: '2026-05-22',
            inputTokens: 80,
            outputTokens: 20,
            projectId: 'workspace:atlas-agent',
            projectName: 'atlas-agent',
            projectProvider: 'Hermes',
            projectSlug: 'atlas-agent',
            repositoryId: 'github.com/Tevpro/atlas',
            repositoryKey: 'github.com/Tevpro/atlas',
            repositoryName: 'atlas',
            requests: 2,
            totalTokens: 100,
          },
        ]
      }
      if (statementSql.includes('FROM repository_model_daily_usage')) {
        return [
          {
            attributionStatus: 'exact',
            cost: 0,
            day: '2026-05-22',
            model: 'gpt-5.4',
            projectId: 'workspace:atlas-agent',
            projectName: 'atlas-agent',
            projectProvider: 'Hermes',
            projectSlug: 'atlas-agent',
            provider: 'Hermes',
            repositoryId: 'github.com/Tevpro/atlas',
            requests: 2,
            tokens: 100,
          },
        ]
      }
      return originalSelectAll(statementSql, params)
    }
    const loaded = await loadDashboardSnapshotForRequest(env, {
      endDay: '2026-05-22',
      preset: 'custom',
      startDay: '2026-05-22',
    })
    expect(loaded.snapshot.repositories.breakdown).toEqual([
      expect.objectContaining({
        repositoryName: 'atlas',
        requests: 2,
        totalTokens: 100,
      }),
    ])
    expect(loaded.snapshot.filters.repositoryModelRows).toEqual([
      expect.objectContaining({
        model: 'gpt-5.4',
        repositoryId: 'github.com/Tevpro/atlas',
        tokens: 100,
      }),
    ])

    const invalidDb = new FakeD1Database()
    await expect(
      ingestExternalRollupsToD1(
        { APP_ENV: 'production', DB: invalidDb as unknown as D1Database },
        {
          ...payload,
          repositoryRollups: [
            { ...payload.repositoryRollups[0], inputTokens: 79 },
          ],
        },
      ),
    ).rejects.toThrow('repository rollups do not reconcile')
    expect(invalidDb.batches).toHaveLength(0)

    await expect(
      ingestExternalRollupsToD1(env, {
        ...payload,
        repositoryRollups: [
          payload.repositoryRollups[0],
          payload.repositoryRollups[0],
        ],
      }),
    ).rejects.toThrow('duplicate repository rollup')
    await expect(
      ingestExternalRollupsToD1(env, {
        ...payload,
        repositoryRollups: [
          {
            ...payload.repositoryRollups[0],
            repository: { key: '/home/operator/atlas', name: 'atlas' },
          },
        ],
      }),
    ).rejects.toThrow('invalid privacy-safe repository identity')
  })

  it('rejects invalid or unreconciled v2 dimensions before D1 mutation', async () => {
    const valid = {
      schemaVersion: 2,
      rollups: [
        {
          cachedTokens: 10,
          estimatedCostUsd: 1.25,
          inputTokens: 60,
          models: [
            {
              estimatedCostUsd: 1.25,
              model: 'gpt-5.4',
              requests: 2,
              tokens: 100,
            },
          ],
          outputTokens: 20,
          reasoningTokens: 10,
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      repositoryRollups: [
        {
          attributionStatus: 'exact' as const,
          cachedTokens: 10,
          estimatedCostUsd: 1.25,
          inputTokens: 60,
          models: [
            {
              estimatedCostUsd: 1.25,
              model: 'gpt-5.4',
              requests: 2,
              tokens: 100,
            },
          ],
          outputTokens: 20,
          reasoningTokens: 10,
          repository: { key: 'github.com/Tevpro/atlas', name: 'atlas' },
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      workspace: { slug: 'atlas-agent' },
    }
    const invalidPayloads = [
      { ...valid, rollups: [...valid.rollups, valid.rollups[0]] },
      { ...valid, rollups: [{ ...valid.rollups[0], inputTokens: Number.NaN }] },
      {
        ...valid,
        rollups: [
          {
            ...valid.rollups[0],
            models: [...valid.rollups[0].models, valid.rollups[0].models[0]],
          },
        ],
      },
      ...(
        [
          'requests',
          'totalTokens',
          'inputTokens',
          'outputTokens',
          'cachedTokens',
          'reasoningTokens',
          'estimatedCostUsd',
        ] as const
      ).map((metric) => ({
        ...valid,
        repositoryRollups: [
          {
            ...valid.repositoryRollups[0],
            [metric]: valid.repositoryRollups[0][metric] + 1,
          },
        ],
      })),
      {
        ...valid,
        repositoryRollups: [
          {
            ...valid.repositoryRollups[0],
            models: [{ ...valid.repositoryRollups[0].models[0], tokens: 99 }],
          },
        ],
      },
      {
        ...valid,
        repositoryRollups: [
          {
            ...valid.repositoryRollups[0],
            models: [
              ...valid.repositoryRollups[0].models,
              valid.repositoryRollups[0].models[0],
            ],
          },
        ],
      },
      {
        ...valid,
        repositoryRollups: [
          {
            ...valid.repositoryRollups[0],
            estimatedCostUsd: Number.POSITIVE_INFINITY,
          },
        ],
      },
    ]

    for (const payload of invalidPayloads) {
      const db = new FakeD1Database()
      await expect(
        ingestExternalRollupsToD1({ DB: db as unknown as D1Database }, payload),
      ).rejects.toThrow()
      expect(db.runs).toHaveLength(0)
      expect(db.batches).toHaveLength(0)
    }
  })

  it('atomically preserves old aggregate data when a repository insert fails', async () => {
    const db = new FakeD1Database()
    db.dailyRollups = [
      {
        cachedTokens: 0,
        cost: 1,
        createdAt: 1,
        day: '2026-05-22',
        environment: 'production',
        id: 'old',
        inputTokens: 40,
        outputTokens: 10,
        p95LatencyMs: 0,
        projectId: 'workspace:atlas-agent',
        requests: 1,
        totalTokens: 50,
      },
    ]
    db.failOnSql = 'INSERT INTO repository_daily_usage'
    const payload = {
      schemaVersion: 2,
      rollups: [
        {
          inputTokens: 80,
          outputTokens: 20,
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      repositoryRollups: [
        {
          attributionStatus: 'exact' as const,
          cachedTokens: 0,
          estimatedCostUsd: 0,
          inputTokens: 80,
          models: [
            { estimatedCostUsd: 0, model: 'gpt-5.4', requests: 2, tokens: 100 },
          ],
          outputTokens: 20,
          reasoningTokens: 0,
          repository: { key: 'github.com/Tevpro/atlas', name: 'atlas' },
          requests: 2,
          totalTokens: 100,
          usageDate: '2026-05-22',
        },
      ],
      workspace: { slug: 'atlas-agent' },
    }

    await expect(
      ingestExternalRollupsToD1({ DB: db as unknown as D1Database }, payload),
    ).rejects.toThrow('forced D1 failure')
    expect(db.batches).toHaveLength(1)
    expect(
      db.batches[0]?.some(({ sql }) =>
        sql.includes('DELETE FROM daily_usage_rollups'),
      ),
    ).toBe(true)
    expect(
      db.batches[0]?.some(({ sql }) =>
        sql.includes('INSERT INTO repository_daily_usage'),
      ),
    ).toBe(true)
    expect(db.dailyRollups[0]?.id).toBe('old')
  })

  it('keeps schema v1 ingestion and dashboard reads independent of repository tables', async () => {
    const db = new FakeD1Database()
    db.repositoryTablesExist = false
    const originalPrepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      if (
        sql.includes('FROM repository_') ||
        sql.includes('INTO repository_')
      ) {
        throw new Error('no such table: repositories')
      }
      return originalPrepare(sql)
    }
    await ingestExternalRollupsToD1(
      { DB: db as unknown as D1Database },
      {
        rollups: [
          {
            inputTokens: 8,
            outputTokens: 2,
            requests: 1,
            usageDate: '2026-05-22',
          },
        ],
        workspace: { slug: 'legacy-agent' },
      },
    )
    expect(db.dailyRollups).toHaveLength(1)

    const loaded = await loadDashboardSnapshotForRequest(
      { DB: db as unknown as D1Database },
      {
        endDay: '2026-05-22',
        preset: 'custom',
        startDay: '2026-05-22',
      },
    )
    expect(loaded.snapshot.table[0]?.totalTokens).toBe(10)
    expect(loaded.snapshot.repositories.breakdown).toEqual([])
  })

  it('writes external Hermes rollups and model usage into D1', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    const payload = {
      environment: 'production',
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [
        {
          actualCostObservedSessions: 5,
          actualCostObservedTokens: 1625,
          actualCostUsd: 3.5,
          cachedTokens: 150,
          estimatedCostUsd: 4.25,
          inputTokens: 1000,
          models: [
            {
              cacheReadTokens: 100,
              cacheWriteTokens: 50,
              estimatedCostUsd: 4.25,
              inputTokens: 1000,
              model: 'gpt-5.4',
              outputTokens: 450,
              provider: 'OpenAI',
              reasoningTokens: 25,
              requests: 12,
              tokens: 1625,
            },
          ],
          outputTokens: 450,
          requests: 12,
          totalTokens: 1625,
          usageDate: '2026-05-22',
        },
      ],
      sourceLabel: 'Hermes plugin sync',
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    } as unknown as ExternalIngestPayload
    const result = await ingestExternalRollupsToD1(env, payload)

    expect(result).toEqual({
      rowsWritten: 1,
      sourceLabel: 'Hermes plugin sync',
      syncedAt: '2026-05-23T12:00:00.000Z',
    })

    expect(db.runs).toHaveLength(0)
    expect(db.batches).toHaveLength(1)
    expect(db.batches[0]?.[0]?.sql).toContain('INSERT INTO workspaces')
    expect(db.batches[0]?.[0]?.params).toEqual([
      'workspace:hermes-usage',
      'hermes-usage',
      'Hermes Usage',
      'Hermes',
      expect.any(Number),
      Date.parse('2026-05-23T12:00:00Z'),
    ])

    expect(
      db.batches[0]?.slice(1, 4).map((statement) => statement.sql),
    ).toEqual([
      'DELETE FROM issue_events WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
      'DELETE FROM repository_daily_usage WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
      'DELETE FROM daily_usage_rollups WHERE workspace_id = ? AND usage_date BETWEEN ? AND ?',
    ])

    const insertBatch = db.batches[0] ?? []
    expect(
      insertBatch.some((statement) =>
        statement.sql.includes('INSERT INTO daily_usage_rollups'),
      ),
    ).toBe(true)
    expect(
      insertBatch.some((statement) =>
        statement.sql.includes('INSERT INTO model_daily_usage'),
      ),
    ).toBe(true)

    const rollupInsert = insertBatch.find((statement) =>
      statement.sql.includes('INSERT INTO daily_usage_rollups'),
    )
    expect(rollupInsert?.params).toEqual([
      'workspace:hermes-usage:2026-05-22',
      'workspace:hermes-usage',
      '2026-05-22',
      'production',
      12,
      1625,
      1000,
      450,
      150,
      4.25,
      3.5,
      5,
      1625,
      0,
      0,
      0,
      Date.parse('2026-05-23T12:00:00Z'),
    ])
    const modelInsert = insertBatch.find((statement) =>
      statement.sql.includes('INSERT INTO model_daily_usage'),
    )
    expect(modelInsert?.params).toEqual([
      'workspace:hermes-usage:2026-05-22:OpenAI:gpt-5.4',
      'workspace:hermes-usage:2026-05-22',
      'gpt-5.4',
      'OpenAI',
      12,
      1625,
      1000,
      450,
      100,
      50,
      25,
      4.25,
    ])
  })

  it('keeps ingestion and tracked usage readable before model-dimension migration', async () => {
    const db = new FakeD1Database(false)
    const env = {
      APP_ENV: 'preview',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await expect(
      ingestExternalRollupsToD1(env, {
        environment: 'production',
        generatedAt: '2026-05-23T12:00:00Z',
        rollups: [
          {
            cachedTokens: 10,
            estimatedCostUsd: 0.5,
            inputTokens: 90,
            models: [
              {
                cacheReadTokens: 10,
                inputTokens: 90,
                model: 'gpt-5.4',
                outputTokens: 20,
                provider: 'OpenAI',
                requests: 1,
                tokens: 120,
              },
            ],
            outputTokens: 20,
            requests: 1,
            totalTokens: 120,
            usageDate: '2026-05-22',
          },
        ],
        sourceLabel: 'Hermes plugin sync',
        workspace: {
          name: 'Legacy Preview',
          provider: 'Hermes',
          slug: 'legacy-preview',
        },
      }),
    ).resolves.toMatchObject({ rowsWritten: 1 })

    const loaded = await loadDashboardSnapshotForRequest(env, { preset: '30d' })
    expect(loaded.snapshot.table).toEqual([
      expect.objectContaining({ day: '2026-05-22', totalTokens: 120 }),
    ])
    expect(loaded.snapshot.pricing.projectedCostMicroUsd).toBeNull()
    expect(
      db.batches
        .flat()
        .find((statement) =>
          statement.sql.includes('INSERT INTO model_daily_usage'),
        )?.params,
    ).toHaveLength(7)
  })

  it('captures current-day pricing after plugin ingestion and fails open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const db = new FakeD1Database()
    const captured: unknown[] = []
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await ingestExternalRollupsToD1(
      env,
      {
        generatedAt: '2026-08-20T12:00:00Z',
        rollups: [
          {
            inputTokens: 100,
            models: [
              {
                inputTokens: 100,
                model: 'gpt-5.4',
                outputTokens: 20,
                provider: 'OpenAI',
                requests: 1,
                tokens: 120,
              },
            ],
            outputTokens: 20,
            requests: 1,
            totalTokens: 120,
            usageDate: '2026-08-20',
          },
        ],
        workspace: {
          name: 'Hermes Usage',
          provider: 'Hermes',
          slug: 'hermes-usage',
        },
      },
      {
        capturePricing: async (_env, references) => {
          captured.push(references)
          throw new Error('pricing catalog unavailable')
        },
      },
    )

    expect(captured).toEqual([
      [
        {
          effectiveDay: '2026-08-20',
          model: 'gpt-5.4',
          provider: 'OpenAI',
        },
      ],
    ])
  })

  it('keeps malformed actual cost unavailable while preserving explicit zero', async () => {
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await ingestExternalRollupsToD1(env, {
      generatedAt: '2026-05-23T12:00:00Z',
      rollups: [
        {
          actualCostObservedSessions: 1,
          actualCostObservedTokens: 120,
          actualCostUsd: null,
          inputTokens: 100,
          outputTokens: 20,
          requests: 1,
          totalTokens: 120,
          usageDate: '2026-05-21',
        },
        {
          actualCostObservedSessions: 1,
          actualCostObservedTokens: 120,
          actualCostUsd: 0,
          inputTokens: 100,
          outputTokens: 20,
          requests: 1,
          totalTokens: 120,
          usageDate: '2026-05-22',
        },
      ],
      workspace: {
        name: 'Hermes Usage',
        provider: 'Hermes',
        slug: 'hermes-usage',
      },
    })

    expect(db.dailyRollups).toEqual([
      expect.objectContaining({
        actualCostObservedSessions: 0,
        actualCostObservedTokens: 0,
        actualCostUsd: null,
      }),
      expect.objectContaining({
        actualCostObservedSessions: 1,
        actualCostObservedTokens: 120,
        actualCostUsd: 0,
      }),
    ])
  })

  it('does not allocate daily OpenAI actual cost into a partial 24-hour window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))
    const db = new FakeD1Database()
    const workspaceId = 'workspace:openai-organization'
    db.workspaces.set(workspaceId, {
      createdAt: Date.parse('2026-05-23T12:00:00Z'),
      id: workspaceId,
      lastIngestedAt: Date.parse('2026-05-23T12:00:00Z'),
      name: 'OpenAI Organization',
      provider: 'OpenAI',
      slug: 'openai-organization',
    })
    db.dailyRollups = [
      {
        actualCostObservedSessions: 1,
        actualCostObservedTokens: 2_400,
        actualCostUsd: 24,
        cachedTokens: 0,
        cost: 0,
        createdAt: Date.parse('2026-05-22T23:59:00Z'),
        day: '2026-05-22',
        environment: 'production',
        id: `${workspaceId}:2026-05-22`,
        inputTokens: 2_000,
        outputTokens: 400,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 24,
        totalTokens: 2_400,
      },
      {
        actualCostObservedSessions: 1,
        actualCostObservedTokens: 1_300,
        actualCostUsd: 13,
        cachedTokens: 0,
        cost: 0,
        createdAt: Date.parse('2026-05-23T12:00:00Z'),
        day: '2026-05-23',
        environment: 'production',
        id: `${workspaceId}:2026-05-23`,
        inputTokens: 1_100,
        outputTokens: 200,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 13,
        totalTokens: 1_300,
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: Array.from({ length: 24 }, (_, index) => ({
            results: [
              {
                input_cached_tokens: 0,
                input_tokens: 80,
                model: 'gpt-5.4',
                num_model_requests: 1,
                output_tokens: 20,
              },
            ],
            start_time:
              Date.parse('2026-05-22T13:00:00Z') / 1_000 + index * 3_600,
          })),
        }),
      ),
    )

    const loaded = await loadDashboardSnapshotForRequest(
      {
        APP_ENV: 'production',
        DB: db as unknown as D1Database,
        OPENAI_API_KEY: 'test-key',
      },
      { preset: '24h' },
    )
    const filtered = filterSnapshotByTimeframe(loaded.snapshot, {
      preset: '24h',
    })

    expect(filtered.actualCost).toMatchObject({
      coverageRatio: 0,
      observedTokens: 0,
      reportedCostUsd: null,
    })
  })

  it('stores OpenAI cached input separately from standard input', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))
    const db = new FakeD1Database()
    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
      OPENAI_API_KEY: 'test-key',
    } satisfies CloudflareAppEnv
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('/usage/completions')) {
          return Response.json({
            data: [
              {
                results: [
                  {
                    input_cached_tokens: 100,
                    input_tokens: 1_000,
                    model: 'gpt-5.4',
                    num_model_requests: 1,
                    output_tokens: 200,
                  },
                ],
                start_time: Date.parse('2026-05-22T00:00:00Z') / 1_000,
              },
            ],
          })
        }
        return Response.json({
          data: [
            {
              results: [
                { amount: {} },
                { amount: { value: null } },
                { amount: { value: 1.5 } },
              ],
              start_time: Date.parse('2026-05-22T00:00:00Z') / 1_000,
            },
          ],
        })
      }),
    )

    await syncOpenAiUsageToD1(env)

    const modelInsert = db.batches
      .flat()
      .find((statement) =>
        statement.sql.includes('INSERT INTO model_daily_usage'),
      )
    expect(modelInsert?.params.slice(4, 12)).toEqual([
      1, 1_200, 900, 200, 100, 0, 0, 0,
    ])
    expect(db.dailyRollups[0]).toMatchObject({
      actualCostObservedSessions: 1,
      actualCostObservedTokens: 1_200,
      actualCostUsd: 1.5,
      cost: 0,
    })
  })

  it('preserves Hermes hourly rollups through D1 loading into the 24h dashboard view', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-23T12:00:00Z'))

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
      expect.objectContaining({
        day: '2026-05-22T13:00:00Z',
        primary: 0,
        secondary: 0,
        tertiary: 0,
      }),
    )
    expect(filtered.charts.requestsCostCache.at(-1)).toEqual(
      expect.objectContaining({
        day: '2026-05-23T12:00:00Z',
        primary: 0,
        secondary: 0,
        tertiary: 0,
      }),
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
      expect.objectContaining({
        model: 'gpt-5.4',
        provider: 'Hermes',
        requests: 5,
        tokens: 520,
      }),
      expect.objectContaining({
        model: 'claude-sonnet-4',
        provider: 'Hermes',
        requests: 4,
        tokens: 410,
      }),
    ])
  })

  it('queries the D1 range selected by the dashboard instead of a fixed history window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))

    const db = new FakeD1Database()
    const workspaceId = 'workspace:hermes-usage'
    const endDay = new Date('2026-08-19T00:00:00Z')
    db.workspaces.set(workspaceId, {
      createdAt: endDay.getTime(),
      id: workspaceId,
      lastIngestedAt: endDay.getTime(),
      name: 'Hermes Usage',
      provider: 'Hermes',
      slug: 'hermes-usage',
    })
    db.dailyRollups = Array.from({ length: 120 }, (_, index) => {
      const date = new Date(endDay)
      date.setUTCDate(date.getUTCDate() - (119 - index))
      const day = date.toISOString().slice(0, 10)
      return {
        cachedTokens: 10,
        cost: 1,
        createdAt: date.getTime(),
        day,
        environment: 'production',
        id: `${workspaceId}:${day}`,
        inputTokens: 100,
        outputTokens: 20,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 1,
        totalTokens: 120,
      }
    })

    const env = {
      APP_ENV: 'production',
      DB: db as unknown as D1Database,
      OPENAI_USAGE_DAYS_BACK: '7',
    } satisfies CloudflareAppEnv
    const customStartDay = db.dailyRollups[10].day
    const customEndDay = db.dailyRollups[109].day

    const defaultResult = await loadDashboardSnapshotForRequest(env)
    const sevenDayResult = await loadDashboardSnapshotForRequest(env, {
      preset: '7d',
    })
    const ninetyDayResult = await loadDashboardSnapshotForRequest(env, {
      preset: '90d',
    })
    const customResult = await loadDashboardSnapshotForRequest(env, {
      endDay: customEndDay,
      preset: 'custom',
      startDay: customStartDay,
    })

    expect(defaultResult.snapshot.filters.dailyRows).toHaveLength(30)
    expect(sevenDayResult.snapshot.filters.dailyRows).toHaveLength(7)
    expect(ninetyDayResult.snapshot.filters.dailyRows).toHaveLength(90)
    expect(customResult.snapshot.filters.dailyRows).toHaveLength(100)
    expect(customResult.snapshot.filters.availableStartDay).toBe(customStartDay)
    expect(customResult.snapshot.filters.availableEndDay).toBe(customEndDay)
  })

  it('reads all D1 snapshot dimensions from one database generation', async () => {
    const db = new FakeD1Database()
    const workspaceId = 'workspace:consistent'
    db.workspaces.set(workspaceId, {
      createdAt: Date.parse('2026-05-23T12:00:00Z'),
      id: workspaceId,
      lastIngestedAt: Date.parse('2026-05-23T12:00:00Z'),
      name: 'Consistent',
      provider: 'Hermes',
      slug: 'consistent',
    })
    db.dailyRollups = [
      {
        cachedTokens: 0,
        cost: 1,
        createdAt: Date.parse('2026-05-23T12:00:00Z'),
        day: '2026-05-22',
        environment: 'production',
        id: 'generation-one-rollup',
        inputTokens: 80,
        outputTokens: 20,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 2,
        totalTokens: 100,
      },
    ]
    db.modelDailyUsage = [
      {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 1,
        id: 'generation-one-model',
        inputTokens: 0,
        model: 'generation-one',
        outputTokens: 0,
        provider: 'Hermes',
        reasoningTokens: 0,
        requests: 2,
        rollupId: 'generation-one-rollup',
        tokens: 100,
      },
    ]
    db.afterStandaloneSelect = (sql) => {
      if (!sql.includes('daily_usage_rollups.environment as environment'))
        return
      db.modelDailyUsage = [
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 2,
          id: 'generation-two-model',
          inputTokens: 0,
          model: 'generation-two',
          outputTokens: 0,
          provider: 'Hermes',
          reasoningTokens: 0,
          requests: 4,
          rollupId: 'generation-one-rollup',
          tokens: 200,
        },
      ]
    }

    const result = await loadDashboardSnapshotForRequest(
      { DB: db as unknown as D1Database },
      { endDay: '2026-05-22', preset: 'custom', startDay: '2026-05-22' },
    )

    expect(result.snapshot.charts.models).toEqual([
      expect.objectContaining({ model: 'generation-one', tokens: 100 }),
    ])
  })

  it('preserves an empty future custom range without querying outside it', async () => {
    const db = new FakeD1Database()
    const workspaceId = 'workspace:hermes-usage'
    const latestDay = '2026-08-19'
    db.workspaces.set(workspaceId, {
      createdAt: Date.parse(`${latestDay}T12:00:00Z`),
      id: workspaceId,
      lastIngestedAt: Date.parse(`${latestDay}T12:00:00Z`),
      name: 'Hermes Usage',
      provider: 'Hermes',
      slug: 'hermes-usage',
    })
    db.dailyRollups = [
      {
        cachedTokens: 10,
        cost: 1,
        createdAt: Date.parse(`${latestDay}T12:00:00Z`),
        day: latestDay,
        environment: 'production',
        id: `${workspaceId}:${latestDay}`,
        inputTokens: 100,
        outputTokens: 20,
        p95LatencyMs: 0,
        projectId: workspaceId,
        requests: 1,
        totalTokens: 120,
      },
    ]

    const result = await loadDashboardSnapshotForRequest(
      { APP_ENV: 'production', DB: db as unknown as D1Database },
      {
        endDay: '2027-01-31',
        preset: 'custom',
        startDay: '2027-01-01',
      },
    )
    const rangeSelect = [...db.selects]
      .reverse()
      .find((statement) =>
        statement.sql.includes(
          'daily_usage_rollups.environment as environment',
        ),
      )

    expect(rangeSelect?.params.slice(-2)).toEqual(['2027-01-01', '2027-02-01'])
    expect(result.snapshot.filters.availableStartDay).toBe('2027-01-01')
    expect(result.snapshot.filters.availableEndDay).toBe('2027-01-31')
    expect(result.snapshot.filters.dailyRows).toEqual([])
    expect(result.snapshot.table).toEqual([])
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
      expect.objectContaining({
        latestGeneratedAt: '2026-05-23T12:00:00.000Z',
        latestRollupDay: null,
        projectName: 'Hermes Usage',
        projectSlug: 'hermes-usage',
      }),
    ])
    expect(filtered.headline.granularity).toBe('hour')
    expect(filtered.charts.requestsCostCache).toHaveLength(24)
    expect(filtered.charts.requestsCostCache[0]).toEqual(
      expect.objectContaining({
        day: '2026-05-22T13:00:00Z',
        primary: 0,
        secondary: 0,
        tertiary: 0,
      }),
    )
    expect(filtered.charts.requestsCostCache.at(-1)).toEqual(
      expect.objectContaining({
        day: '2026-05-23T12:00:00Z',
        primary: 0,
        secondary: 0,
        tertiary: 0,
      }),
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
      '2 projects are contributing rollups. Last sync 12m ago. Latest usage bucket: Jun 10, 2026, 10:00 AM CDT.',
    )
  })
})
