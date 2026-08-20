export type ModelPricingReference = {
  model: string
  provider: string
}

export type ModelPricingRate = {
  cacheReadMicroUsdPerMtok: number
  cacheWriteMicroUsdPerMtok: number
  inputMicroUsdPerMtok: number
  outputMicroUsdPerMtok: number
  resolved: boolean
  sourceModel: string | null
  sourceProvider: string | null
}

export type ModelTokenDimensions = {
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
}

export type CachedModelPricingRate = ModelPricingRate & {
  fetchedAt: number
  priceKey: string
  requestedModel: string
  requestedProvider: string
  sourceUrl: string
}

export type PublicPricingLoadResult = {
  availability: 'available' | 'stale' | 'unavailable'
  rates: CachedModelPricingRate[]
  sourceUrl: string
}

export type PublicPricingSummary = {
  availability: PublicPricingLoadResult['availability']
  coveredTokens: number
  coverageRatio: number
  label: 'Estimated public API equivalent — current standard rates'
  projectedCostMicroUsd: number | null
  sourceUrl: string
  totalTokens: number
  unpricedModels: string[]
}

type PricingUsageModel = Partial<ModelTokenDimensions> & ModelPricingReference & {
  tokens: number
}

type RemotePricingEntry = {
  cache_creation_input_token_cost?: number
  cache_read_input_token_cost?: number
  input_cost_per_token?: number
  litellm_provider?: string
  output_cost_per_token?: number
}

type RemotePricingCatalog = Partial<Record<string, RemotePricingEntry>>

const EXPLICIT_MODEL_ALIASES: Record<string, string> = {
  'anthropic:claude-sonnet-4': 'claude-sonnet-4-20250514',
}

const PROVIDER_CATALOG_PREFIX: Record<string, string> = {
  anthropic: 'anthropic',
  google: 'gemini',
  openai: 'openai',
}

const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const DEFAULT_REFRESH_MS = 12 * 60 * 60 * 1000

export async function loadPublicModelPricing(
  env: {
    DB: D1Database
    PUBLIC_MODEL_PRICING_REFRESH_HOURS?: string
    PUBLIC_MODEL_PRICING_SOURCE_URL?: string
  },
  references: ModelPricingReference[],
  options: {
    fetchCatalog?: () => Promise<RemotePricingCatalog>
    now?: () => number
  } = {},
): Promise<PublicPricingLoadResult> {
  const sourceUrl = env.PUBLIC_MODEL_PRICING_SOURCE_URL || DEFAULT_SOURCE_URL
  const now = options.now || Date.now
  const uniqueReferences = dedupeReferences(references)
  if (uniqueReferences.length === 0) {
    return { availability: 'available', rates: [], sourceUrl }
  }

  let cachedRates: CachedModelPricingRate[]
  try {
    cachedRates = await loadCachedRates(env.DB, uniqueReferences)
  } catch {
    return { availability: 'unavailable', rates: [], sourceUrl }
  }

  const cachedByKey = new Map(cachedRates.map((rate) => [rate.priceKey, rate]))
  const refreshMs = getRefreshMs(env.PUBLIC_MODEL_PRICING_REFRESH_HOURS)
  const staleReferences = uniqueReferences.filter((reference) => {
    const cached = cachedByKey.get(getPricingKey(reference))
    return (
      !cached ||
      cached.sourceUrl !== sourceUrl ||
      now() - cached.fetchedAt > refreshMs
    )
  })
  if (staleReferences.length === 0) {
    return { availability: 'available', rates: cachedRates, sourceUrl }
  }

  try {
    const catalog = await (options.fetchCatalog || (() => fetchCatalog(sourceUrl)))()
    const refreshed = staleReferences.map((reference) => ({
      ...resolveCatalogRate(reference, catalog),
      fetchedAt: now(),
      priceKey: getPricingKey(reference),
      requestedModel: reference.model,
      requestedProvider: reference.provider,
      sourceUrl,
    }))
    try {
      await persistRates(env.DB, refreshed)
    } catch {
      // The in-memory estimate is still useful; cache persistence is optional.
    }
    for (const rate of refreshed) {
      cachedByKey.set(rate.priceKey, rate)
    }
    return {
      availability: 'available',
      rates: [...cachedByKey.values()],
      sourceUrl,
    }
  } catch {
    return {
      availability: cachedRates.length > 0 ? 'stale' : 'unavailable',
      rates: cachedRates,
      sourceUrl: cachedRates[0]?.sourceUrl || sourceUrl,
    }
  }
}

export function summarizePublicPricing(
  models: PricingUsageModel[],
  pricing: PublicPricingLoadResult,
): PublicPricingSummary {
  const ratesByKey = new Map(
    pricing.rates.map((rate) => [rate.priceKey, rate]),
  )
  let coveredTokens = 0
  let projectedCostMicroUsd = 0
  let hasEstimate = false
  const unpricedModels = new Set<string>()

  for (const model of models) {
    const rate = ratesByKey.get(getPricingKey(model))
    const dimensions = {
      cacheReadTokens: model.cacheReadTokens || 0,
      cacheWriteTokens: model.cacheWriteTokens || 0,
      inputTokens: model.inputTokens || 0,
      outputTokens: model.outputTokens || 0,
      reasoningTokens: model.reasoningTokens || 0,
    }
    const dimensionTokens = Object.values(dimensions).reduce(
      (sum, tokens) => sum + tokens,
      0,
    )
    const estimate =
      rate && dimensionTokens > 0 && dimensionTokens === model.tokens
        ? estimateCurrentRateMicroUsd(dimensions, rate)
        : null
    if (estimate === null) {
      unpricedModels.add(model.model)
      continue
    }
    hasEstimate = true
    projectedCostMicroUsd += estimate
    coveredTokens += model.tokens
  }

  const totalTokens = models.reduce((sum, model) => sum + model.tokens, 0)
  return {
    availability: pricing.availability,
    coveredTokens,
    coverageRatio: totalTokens > 0 ? coveredTokens / totalTokens : 0,
    label: 'Estimated public API equivalent — current standard rates',
    projectedCostMicroUsd: hasEstimate ? projectedCostMicroUsd : null,
    sourceUrl: pricing.sourceUrl,
    totalTokens,
    unpricedModels: [...unpricedModels].sort(),
  }
}

export function resolveCatalogRate(
  reference: ModelPricingReference,
  catalog: RemotePricingCatalog,
): ModelPricingRate {
  const provider = normalizeProvider(reference.provider)
  const alias = EXPLICIT_MODEL_ALIASES[`${provider}:${reference.model}`]
  const providerPrefix = PROVIDER_CATALOG_PREFIX[provider]
  const candidates = [
    alias,
    reference.model,
    providerPrefix ? `${providerPrefix}/${reference.model}` : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const sourceModel of candidates) {
    const entry = catalog[sourceModel]
    if (!entry || normalizeProvider(entry.litellm_provider || '') !== provider) {
      continue
    }
    const inputRate = toMicroUsdPerMtok(entry.input_cost_per_token)
    const outputRate = toMicroUsdPerMtok(entry.output_cost_per_token)
    if (inputRate === 0 && outputRate === 0) {
      continue
    }
    return {
      cacheReadMicroUsdPerMtok: toMicroUsdPerMtok(
        entry.cache_read_input_token_cost,
      ),
      cacheWriteMicroUsdPerMtok: toMicroUsdPerMtok(
        entry.cache_creation_input_token_cost,
      ),
      inputMicroUsdPerMtok: inputRate,
      outputMicroUsdPerMtok: outputRate,
      resolved: true,
      sourceModel,
      sourceProvider: entry.litellm_provider || null,
    }
  }

  return unresolvedRate()
}

export function estimateCurrentRateMicroUsd(
  usage: ModelTokenDimensions,
  pricing: ModelPricingRate,
): number | null {
  if (!pricing.resolved) {
    return null
  }

  const billable = [
    [usage.inputTokens, pricing.inputMicroUsdPerMtok],
    [usage.outputTokens + usage.reasoningTokens, pricing.outputMicroUsdPerMtok],
    [usage.cacheReadTokens, pricing.cacheReadMicroUsdPerMtok],
    [usage.cacheWriteTokens, pricing.cacheWriteMicroUsdPerMtok],
  ] as const

  if (billable.some(([tokens, rate]) => tokens > 0 && rate <= 0)) {
    return null
  }

  const total = billable.reduce(
    (sum, [tokens, rate]) => sum + roundedMicroUsd(tokens, rate),
    0n,
  )
  const numeric = Number(total)
  return Number.isSafeInteger(numeric) ? numeric : null
}

export function getPricingKey(reference: ModelPricingReference) {
  return `${normalizeProvider(reference.provider)}:${reference.model.trim().toLowerCase()}`
}

async function loadCachedRates(
  db: D1Database,
  references: ModelPricingReference[],
) {
  const keys = references.map(getPricingKey)
  const result = await db
    .prepare(
      `SELECT price_key as priceKey,
              requested_provider as requestedProvider,
              requested_model as requestedModel,
              source_provider as sourceProvider,
              source_model as sourceModel,
              input_micro_usd_per_mtok as inputMicroUsdPerMtok,
              output_micro_usd_per_mtok as outputMicroUsdPerMtok,
              cache_read_micro_usd_per_mtok as cacheReadMicroUsdPerMtok,
              cache_write_micro_usd_per_mtok as cacheWriteMicroUsdPerMtok,
              resolved as resolved,
              fetched_at as fetchedAt,
              source_url as sourceUrl
       FROM public_model_pricing_cache
       WHERE price_key IN (${keys.map(() => '?').join(', ')})`,
    )
    .bind(...keys)
    .all<CachedModelPricingRate>()

  return result.results.map((rate) => ({
    ...rate,
    resolved: Boolean(rate.resolved),
  }))
}

async function persistRates(db: D1Database, rates: CachedModelPricingRate[]) {
  if (rates.length === 0) {
    return
  }
  await db.batch(
    rates.map((rate) =>
      db
        .prepare(
          `INSERT INTO public_model_pricing_cache (
             price_key, requested_provider, requested_model, source_provider,
             source_model, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
             cache_read_micro_usd_per_mtok, cache_write_micro_usd_per_mtok,
             resolved, fetched_at, source_url
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(price_key) DO UPDATE SET
             requested_provider = excluded.requested_provider,
             requested_model = excluded.requested_model,
             source_provider = excluded.source_provider,
             source_model = excluded.source_model,
             input_micro_usd_per_mtok = excluded.input_micro_usd_per_mtok,
             output_micro_usd_per_mtok = excluded.output_micro_usd_per_mtok,
             cache_read_micro_usd_per_mtok = excluded.cache_read_micro_usd_per_mtok,
             cache_write_micro_usd_per_mtok = excluded.cache_write_micro_usd_per_mtok,
             resolved = excluded.resolved,
             fetched_at = excluded.fetched_at,
             source_url = excluded.source_url`,
        )
        .bind(
          rate.priceKey,
          rate.requestedProvider,
          rate.requestedModel,
          rate.sourceProvider,
          rate.sourceModel,
          rate.inputMicroUsdPerMtok,
          rate.outputMicroUsdPerMtok,
          rate.cacheReadMicroUsdPerMtok,
          rate.cacheWriteMicroUsdPerMtok,
          rate.resolved ? 1 : 0,
          rate.fetchedAt,
          rate.sourceUrl,
        ),
    ),
  )
}

async function fetchCatalog(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok) {
    throw new Error(`Pricing catalog returned HTTP ${response.status}`)
  }
  return response.json<RemotePricingCatalog>()
}

function dedupeReferences(references: ModelPricingReference[]) {
  return [
    ...new Map(
      references.map((reference) => [getPricingKey(reference), reference]),
    ).values(),
  ]
}

function getRefreshMs(value: string | undefined) {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0
    ? hours * 60 * 60 * 1000
    : DEFAULT_REFRESH_MS
}

function roundedMicroUsd(tokens: number, microUsdPerMtok: number) {
  const numerator =
    BigInt(Math.max(0, Math.trunc(tokens))) * BigInt(microUsdPerMtok)
  return (numerator + 500_000n) / 1_000_000n
}

function toMicroUsdPerMtok(costPerToken: number | undefined) {
  if (!Number.isFinite(costPerToken) || !costPerToken || costPerToken < 0) {
    return 0
  }
  return Math.round(costPerToken * 1_000_000_000_000)
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'gemini' || normalized.startsWith('vertex_ai')) {
    return 'google'
  }
  return normalized
}

function unresolvedRate(): ModelPricingRate {
  return {
    cacheReadMicroUsdPerMtok: 0,
    cacheWriteMicroUsdPerMtok: 0,
    inputMicroUsdPerMtok: 0,
    outputMicroUsdPerMtok: 0,
    resolved: false,
    sourceModel: null,
    sourceProvider: null,
  }
}
