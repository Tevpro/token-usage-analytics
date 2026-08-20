import { describe, expect, it } from 'vitest'

import {
  estimateCurrentRateMicroUsd,
  loadPublicModelPricing,
  resolveCatalogRate,
  summarizePublicPricing,
} from '#/lib/public-model-pricing'

const catalog = {
  'claude-sonnet-4-20250514': {
    cache_creation_input_token_cost: 3.75e-6,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    litellm_provider: 'anthropic',
    output_cost_per_token: 15e-6,
  },
  'gpt-5.4': {
    cache_read_input_token_cost: 2.5e-7,
    input_cost_per_token: 2.5e-6,
    litellm_provider: 'openai',
    output_cost_per_token: 15e-6,
  },
  'openrouter/anthropic/claude-sonnet-4': {
    input_cost_per_token: 99e-6,
    litellm_provider: 'openrouter',
    output_cost_per_token: 99e-6,
  },
} as const

describe('public model pricing', () => {
  it('resolves only exact provider/model entries or explicit aliases', () => {
    expect(resolveCatalogRate({ model: 'gpt-5.4', provider: 'OpenAI' }, catalog)).toMatchObject({
      resolved: true,
      sourceModel: 'gpt-5.4',
      sourceProvider: 'openai',
    })
    expect(resolveCatalogRate({ model: 'claude-sonnet-4', provider: 'Anthropic' }, catalog)).toMatchObject({
      resolved: true,
      sourceModel: 'claude-sonnet-4-20250514',
      sourceProvider: 'anthropic',
    })
  })

  it('leaves ambiguous and unknown model ids unresolved', () => {
    expect(resolveCatalogRate({ model: 'sonnet-4', provider: 'Anthropic' }, catalog).resolved).toBe(false)
    expect(resolveCatalogRate({ model: 'gpt-5.4', provider: 'Anthropic' }, catalog).resolved).toBe(false)
  })

  it('prices cache reads, cache writes, and reasoning with distinct rates', () => {
    const rate = resolveCatalogRate({ model: 'claude-sonnet-4', provider: 'Anthropic' }, catalog)

    expect(
      estimateCurrentRateMicroUsd(
        {
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 1_000_000,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          reasoningTokens: 1_000_000,
        },
        rate,
      ),
    ).toBe(37_050_000)
  })

  it('retains microdollar precision until estimates are aggregated', () => {
    const rate = {
      cacheReadMicroUsdPerMtok: 0,
      cacheWriteMicroUsdPerMtok: 0,
      inputMicroUsdPerMtok: 1_000_000,
      outputMicroUsdPerMtok: 0,
      resolved: true,
      sourceModel: 'tiny-model',
      sourceProvider: 'test',
    }
    const rows = Array.from({ length: 100 }, () =>
      estimateCurrentRateMicroUsd(
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokens: 1_000,
          outputTokens: 0,
          reasoningTokens: 0,
        },
        rate,
      ),
    )

    expect(rows.reduce<number>((sum, value) => sum + (value || 0), 0)).toBe(100_000)
  })

  it('keeps analytics available when the optional pricing table is absent', async () => {
    let fetched = false
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error('D1_ERROR: no such table: public_model_pricing_cache')
          },
        }),
      }),
    } as unknown as D1Database

    await expect(
      loadPublicModelPricing(
        { DB: db },
        [{ model: 'gpt-5.4', provider: 'OpenAI' }],
        {
          fetchCatalog: async () => {
            fetched = true
            return catalog
          },
        },
      ),
    ).resolves.toMatchObject({ availability: 'unavailable', rates: [] })
    expect(fetched).toBe(false)
  })

  it('does not refresh an immutable snapshot after it is stored', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                cacheReadMicroUsdPerMtok: 250_000,
                cacheWriteMicroUsdPerMtok: 0,
                fetchedAt: 1,
                inputMicroUsdPerMtok: 2_500_000,
                outputMicroUsdPerMtok: 15_000_000,
                priceKey: 'openai:gpt-5.4',
                requestedModel: 'gpt-5.4',
                requestedProvider: 'OpenAI',
                resolved: 1,
                sourceModel: 'gpt-5.4',
                sourceProvider: 'openai',
                sourceUrl: 'https://pricing.example/catalog.json',
              },
            ],
          }),
        }),
      }),
    } as unknown as D1Database

    const result = await loadPublicModelPricing(
      { DB: db },
      [{ model: 'gpt-5.4', provider: 'OpenAI' }],
      {
        fetchCatalog: async () => {
          throw new Error('catalog offline')
        },
        now: () => 10_000_000_000,
      },
    )

    expect(result.availability).toBe('available')
    expect(result.sourceUrl).toBe('https://pricing.example/catalog.json')
    expect(result.rates).toEqual([
      expect.objectContaining({ priceKey: 'openai:gpt-5.4', resolved: true }),
    ])
  })

  it('leaves a missing historical day unpriced instead of applying the current catalog', async () => {
    let fetched = false
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database

    const result = await loadPublicModelPricing(
      { DB: db },
      [{ effectiveDay: '2026-08-19', model: 'gpt-5.4', provider: 'OpenAI' }],
      {
        fetchCatalog: async () => {
          fetched = true
          throw new Error('historical catalog access is forbidden')
        },
        now: () => Date.parse('2026-08-20T12:00:00Z'),
      },
    )

    expect(fetched).toBe(false)
    expect(result).toMatchObject({ availability: 'unavailable', rates: [] })
  })

  it('fails pricing open when an immutable snapshot cannot be persisted', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
      batch: async () => {
        throw new Error('D1 pricing write unavailable')
      },
    } as unknown as D1Database

    await expect(
      loadPublicModelPricing(
        { DB: db },
        [{ effectiveDay: '2026-08-20', model: 'gpt-5.4', provider: 'OpenAI' }],
        {
          fetchCatalog: async () => catalog,
          now: () => Date.parse('2026-08-20T12:00:00Z'),
        },
      ),
    ).resolves.toMatchObject({ availability: 'unavailable', rates: [] })
  })

  it('uses the UTC usage day at the Houston date boundary', async () => {
    let fetched = false
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
      batch: async () => [],
    } as unknown as D1Database

    await loadPublicModelPricing(
      { DB: db },
      [{ effectiveDay: '2026-08-20', model: 'gpt-5.4', provider: 'OpenAI' }],
      {
        fetchCatalog: async () => {
          fetched = true
          return catalog
        },
        now: () => Date.parse('2026-08-20T01:00:00Z'),
      },
    )

    expect(fetched).toBe(true)
  })

  it('returns the persisted winner after a concurrent snapshot insert', async () => {
    let reads = 0
    const persistedWinner = {
      cacheReadMicroUsdPerMtok: 125_000,
      cacheWriteMicroUsdPerMtok: 0,
      effectiveDay: '2026-08-20',
      fetchedAt: Date.parse('2026-08-20T00:00:00Z'),
      inputMicroUsdPerMtok: 7_000_000,
      outputMicroUsdPerMtok: 10_000_000,
      priceKey: 'openai:gpt-5.4',
      requestedModel: 'gpt-5.4',
      requestedProvider: 'OpenAI',
      resolved: true,
      sourceModel: 'gpt-5.4',
      sourceProvider: 'openai',
      sourceUrl: 'https://catalog-a.example/rates.json',
    }
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: reads++ === 0 ? [] : [persistedWinner] }),
        }),
      }),
      batch: async () => [],
    } as unknown as D1Database

    const result = await loadPublicModelPricing(
      { DB: db, PUBLIC_MODEL_PRICING_SOURCE_URL: 'https://catalog-b.example/rates.json' },
      [{ effectiveDay: '2026-08-20', model: 'gpt-5.4', provider: 'OpenAI' }],
      {
        fetchCatalog: async () => catalog,
        now: () => Date.parse('2026-08-20T12:00:00Z'),
      },
    )

    expect(result.rates).toEqual([
      expect.objectContaining({
        inputMicroUsdPerMtok: 7_000_000,
        sourceUrl: 'https://catalog-a.example/rates.json',
      }),
    ])
  })

  it('creates a new immutable snapshot when the effective day changes', async () => {
    let fetched = false
    let persisted = false
    const writes: string[] = []
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                cacheReadMicroUsdPerMtok: 250_000,
                cacheWriteMicroUsdPerMtok: 0,
                effectiveDay: persisted ? '2026-08-20' : '2026-08-19',
                fetchedAt: 9_999_999_999,
                inputMicroUsdPerMtok: 2_500_000,
                outputMicroUsdPerMtok: 15_000_000,
                priceKey: 'openai:gpt-5.4',
                requestedModel: 'gpt-5.4',
                requestedProvider: 'OpenAI',
                resolved: 1,
                sourceModel: 'gpt-5.4',
                sourceProvider: 'openai',
                sourceUrl: 'https://pricing.example/catalog.json',
              },
            ],
          }),
          run: async () => {
            persisted = true
            writes.push(sql)
          },
        }),
      }),
      batch: async (statements: Array<{ run: () => Promise<void> }>) => {
        await Promise.all(statements.map((statement) => statement.run()))
      },
    } as unknown as D1Database

    const result = await loadPublicModelPricing(
      {
        DB: db,
        PUBLIC_MODEL_PRICING_SOURCE_URL: 'https://pricing.example/catalog.json',
      },
      [
        {
          effectiveDay: '2026-08-20',
          model: 'gpt-5.4',
          provider: 'OpenAI',
        },
      ],
      {
        fetchCatalog: async () => {
          fetched = true
          return catalog
        },
        now: () => Date.parse('2026-08-20T18:00:00Z'),
      },
    )

    expect(fetched).toBe(true)
    expect(
      writes.some((sql) =>
        sql.includes('ON CONFLICT(effective_day, price_key) DO NOTHING'),
      ),
    ).toBe(true)
    expect(result.rates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectiveDay: '2026-08-20' }),
      ]),
    )
  })

  it('prices each usage day with its own immutable rate snapshot', () => {
    const result = summarizePublicPricing(
      [
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          day: '2026-08-19',
          inputTokens: 1_000_000,
          model: 'gpt-5.4',
          outputTokens: 0,
          provider: 'OpenAI',
          reasoningTokens: 0,
          tokens: 1_000_000,
        },
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          day: '2026-08-20',
          inputTokens: 1_000_000,
          model: 'gpt-5.4',
          outputTokens: 0,
          provider: 'OpenAI',
          reasoningTokens: 0,
          tokens: 1_000_000,
        },
      ],
      {
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
    )

    expect(result.projectedCostMicroUsd).toBe(5_000_000)
    expect(result.coveredTokens).toBe(2_000_000)
  })

  it('recomputes priced coverage from the models in the active selection', () => {
    const result = summarizePublicPricing(
      [
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokens: 1_000,
          model: 'tiny-model',
          outputTokens: 0,
          provider: 'Test',
          reasoningTokens: 0,
          tokens: 1_000,
        },
        {
          inputTokens: 500,
          model: 'unknown-model',
          provider: 'Test',
          tokens: 500,
        },
      ],
      {
        availability: 'available',
        rates: [
          {
            cacheReadMicroUsdPerMtok: 0,
            cacheWriteMicroUsdPerMtok: 0,
            fetchedAt: 1,
            inputMicroUsdPerMtok: 1_000_000,
            outputMicroUsdPerMtok: 0,
            priceKey: 'test:tiny-model',
            requestedModel: 'tiny-model',
            requestedProvider: 'Test',
            resolved: true,
            sourceModel: 'tiny-model',
            sourceProvider: 'test',
            sourceUrl: 'https://pricing.example/catalog.json',
          },
        ],
        sourceUrl: 'https://pricing.example/catalog.json',
      },
    )

    expect(result).toMatchObject({
      availability: 'available',
      coveredTokens: 1_000,
      projectedCostMicroUsd: 1_000,
      totalTokens: 1_500,
      unpricedModels: ['unknown-model'],
    })
  })

  it('leaves models with incomplete token dimensions unpriced', () => {
    const result = summarizePublicPricing(
      [
        {
          inputTokens: 100,
          model: 'tiny-model',
          provider: 'Test',
          tokens: 1_000,
        },
      ],
      {
        availability: 'available',
        rates: [
          {
            cacheReadMicroUsdPerMtok: 0,
            cacheWriteMicroUsdPerMtok: 0,
            fetchedAt: 1,
            inputMicroUsdPerMtok: 1_000_000,
            outputMicroUsdPerMtok: 1_000_000,
            priceKey: 'test:tiny-model',
            requestedModel: 'tiny-model',
            requestedProvider: 'Test',
            resolved: true,
            sourceModel: 'tiny-model',
            sourceProvider: 'test',
            sourceUrl: 'https://pricing.example/catalog.json',
          },
        ],
        sourceUrl: 'https://pricing.example/catalog.json',
      },
    )

    expect(result).toMatchObject({
      coveredTokens: 0,
      coverageRatio: 0,
      projectedCostMicroUsd: null,
      totalTokens: 1_000,
      unpricedModels: ['tiny-model'],
    })
  })
})
