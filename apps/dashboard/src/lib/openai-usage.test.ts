import { describe, expect, it } from 'vitest'

import { ingestExternalRollupsToD1 } from '#/lib/openai-usage'
import type { CloudflareAppEnv } from '#/lib/runtime'

type BoundStatement = {
  params: unknown[]
  sql: string
}

class FakePreparedStatement {
  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new FakePreparedStatement(this.db, this.sql, params)
  }

  async run() {
    this.db.runs.push({ params: this.params, sql: this.sql })
    return { success: true }
  }
}

class FakeD1Database {
  runs: BoundStatement[] = []
  batches: BoundStatement[][] = []

  prepare(sql: string) {
    return new FakePreparedStatement(this, sql)
  }

  async batch(statements: FakePreparedStatement[]) {
    const batch = statements.map((statement) => ({
      params: statement.params,
      sql: statement.sql,
    }))
    this.batches.push(batch)
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

  it('rejects payloads without rollups', async () => {
    const env = {
      DB: new FakeD1Database() as unknown as D1Database,
    } satisfies CloudflareAppEnv

    await expect(
      ingestExternalRollupsToD1(env, {
        rollups: [],
      }),
    ).rejects.toThrow('Ingest payload did not include any rollups.')
  })
})
