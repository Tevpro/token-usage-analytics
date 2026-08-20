export type ModelPricingReference = {
  effectiveDay?: string
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
  effectiveDay?: string
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
  label: 'Estimated public API equivalent — effective daily rates'
  projectedCostMicroUsd: number | null
  sourceUrl: string
  totalTokens: number
  unpricedModels: string[]
}

type PricingUsageModel = Partial<ModelTokenDimensions> &
  ModelPricingReference & {
    day?: string
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

type PublicPricingEnv = {
  DB: D1Database
  PUBLIC_MODEL_PRICING_SOURCE_URL?: string
}

type CapturePricing = (
  env: PublicPricingEnv,
  references: ModelPricingReference[],
) => Promise<PublicPricingLoadResult>

export async function captureDailyPricingForKnownModels(
  env: PublicPricingEnv,
  options: {
    capturePricing?: CapturePricing
    now?: () => number
  } = {},
): Promise<PublicPricingLoadResult> {
  const sourceUrl = env.PUBLIC_MODEL_PRICING_SOURCE_URL || DEFAULT_SOURCE_URL
  try {
    const knownModels = await env.DB.prepare(
      `SELECT DISTINCT provider, model
       FROM model_daily_usage
       WHERE provider <> '' AND model <> ''
       ORDER BY provider, model`,
    ).all<{ model: string; provider: string }>()
    const effectiveDay = formatUtcIsoDay((options.now || Date.now)())
    const references = knownModels.results.map((row) => ({
      effectiveDay,
      model: row.model,
      provider: row.provider,
    }))
    if (options.capturePricing) {
      return await options.capturePricing(env, references)
    }
    return await loadPublicModelPricing(env, references, { now: options.now })
  } catch {
    return { availability: 'unavailable', rates: [], sourceUrl }
  }
}

export async function loadPublicModelPricing(
  env: PublicPricingEnv,
  references: ModelPricingReference[],
  options: {
    fetchCatalog?: () => Promise<RemotePricingCatalog>
    now?: () => number
  } = {},
): Promise<PublicPricingLoadResult> {
  const sourceUrl = env.PUBLIC_MODEL_PRICING_SOURCE_URL || DEFAULT_SOURCE_URL
  const now = options.now || Date.now
  const currentDay = formatUtcIsoDay(now())
  const uniqueReferences = dedupeReferences(
    references.map((reference) => ({
      ...reference,
      effectiveDay: reference.effectiveDay || currentDay,
    })),
  )
  if (uniqueReferences.length === 0) {
    return { availability: 'available', rates: [], sourceUrl }
  }

  let cachedRates: CachedModelPricingRate[]
  try {
    cachedRates = (await loadCachedRates(env.DB, uniqueReferences)).map(
      (rate) => ({
        ...rate,
        effectiveDay: rate.effectiveDay || currentDay,
      }),
    )
  } catch {
    return { availability: 'unavailable', rates: [], sourceUrl }
  }

  const cachedByKey = new Map(
    cachedRates.map((rate) => [
      getDailyPricingKey(rate.effectiveDay, rate.priceKey),
      rate,
    ]),
  )
  const missingCurrentReferences = uniqueReferences.filter(
    (reference) =>
      reference.effectiveDay === currentDay &&
      !cachedByKey.has(
        getDailyPricingKey(reference.effectiveDay, getPricingKey(reference)),
      ),
  )
  if (missingCurrentReferences.length === 0) {
    return {
      availability: cachedRates.length > 0 ? 'available' : 'unavailable',
      rates: cachedRates,
      sourceUrl: cachedRates[0]?.sourceUrl || sourceUrl,
    }
  }

  try {
    const catalog = await (
      options.fetchCatalog || (() => fetchCatalog(sourceUrl))
    )()
    const snapshots = missingCurrentReferences.map((reference) => ({
      ...resolveCatalogRate(reference, catalog),
      effectiveDay: currentDay,
      fetchedAt: now(),
      priceKey: getPricingKey(reference),
      requestedModel: reference.model,
      requestedProvider: reference.provider,
      sourceUrl,
    }))
    await persistRates(env.DB, snapshots)
    const persistedRates = await loadCachedRates(env.DB, uniqueReferences)
    return {
      availability: 'available',
      rates: persistedRates,
      sourceUrl: persistedRates[0]?.sourceUrl || sourceUrl,
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
    pricing.rates.map((rate) => [
      getDailyPricingKey(rate.effectiveDay, rate.priceKey),
      rate,
    ]),
  )
  let coveredTokens = 0
  let projectedCostMicroUsd = 0
  let hasEstimate = false
  const unpricedModels = new Set<string>()

  for (const model of models) {
    const rate = ratesByKey.get(
      getDailyPricingKey(model.day, getPricingKey(model)),
    )
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
    label: 'Estimated public API equivalent — effective daily rates',
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

function getDailyPricingKey(day: string | undefined, priceKey: string) {
  return `${day || ''}:${priceKey}`
}

async function loadCachedRates(
  db: D1Database,
  references: ModelPricingReference[],
) {
  const keys = [...new Set(references.map(getPricingKey))]
  const days = [
    ...new Set(references.map((reference) => reference.effectiveDay || '')),
  ]
  const result = await db
    .prepare(
      `SELECT effective_day as effectiveDay,
              price_key as priceKey,
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
       FROM public_model_pricing_daily
       WHERE price_key IN (${keys.map(() => '?').join(', ')})
         AND effective_day IN (${days.map(() => '?').join(', ')})`,
    )
    .bind(...keys, ...days)
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
          `INSERT INTO public_model_pricing_daily (
             effective_day, price_key, requested_provider, requested_model,
             source_provider, source_model, input_micro_usd_per_mtok,
             output_micro_usd_per_mtok, cache_read_micro_usd_per_mtok,
             cache_write_micro_usd_per_mtok, resolved, fetched_at, source_url
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(effective_day, price_key) DO NOTHING`,
        )
        .bind(
          rate.effectiveDay,
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
      references.map((reference) => [
        getDailyPricingKey(reference.effectiveDay, getPricingKey(reference)),
        reference,
      ]),
    ).values(),
  ]
}

function formatUtcIsoDay(timestampMs: number) {
  return new Date(timestampMs).toISOString().slice(0, 10)
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
