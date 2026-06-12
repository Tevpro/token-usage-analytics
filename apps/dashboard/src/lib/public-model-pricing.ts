import type { CloudflareAppEnv } from '#/lib/runtime'

export type ModelPricingLookupRow = {
  cacheReadInputCostPerToken: number
  fetchedAt: number
  inputCostPerToken: number
  matchKey: string
  requestedModel: string
  resolved: boolean
  sourceModel: string | null
  sourceProvider: string | null
  sourceUrl: string
  outputCostPerToken: number
}

export type ModelPricingReference = {
  model: string
  provider?: string
  tokens?: number
}

export type DashboardPricingStatus = {
  coverageRatio: number
  coveredModelCount: number
  coveredTokens: number
  lastRefreshedAt: string | null
  sourceLabel: string
  sourceUrl: string
  totalModelCount: number
  totalTokens: number
}

export type PricingLookupResult = {
  lookup: Map<string, ModelPricingLookupRow>
  status: DashboardPricingStatus
}

type RemotePricingEntry = {
  cache_read_input_token_cost?: number
  input_cost_per_token?: number
  litellm_provider?: string
  output_cost_per_token?: number
}

const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const DEFAULT_SOURCE_LABEL = 'Public API pricing'
const DEFAULT_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000

export async function ensureModelPricingForReferences(
  env: CloudflareAppEnv,
  references: ModelPricingReference[],
): Promise<PricingLookupResult> {
  const normalizedRefs = dedupeReferences(references)
  const sourceUrl = env.PUBLIC_MODEL_PRICING_SOURCE_URL || DEFAULT_SOURCE_URL
  const refreshIntervalMs = getRefreshIntervalMs(env)

  if (normalizedRefs.length === 0) {
    return {
      lookup: new Map(),
      status: buildPricingStatus([], sourceUrl),
    }
  }

  const cachedRows = await loadCachedRows(env.DB, normalizedRefs)
  const staleOrMissingRefs = normalizedRefs.filter((reference) => {
    const cached = cachedRows.get(reference.matchKey)
    if (!cached) {
      return true
    }
    return Date.now() - cached.fetchedAt > refreshIntervalMs
  })

  if (staleOrMissingRefs.length > 0) {
    const remoteCatalog = await fetchRemoteCatalog(sourceUrl)
    const refreshedRows = staleOrMissingRefs.map((reference) =>
      buildLookupRow(reference, remoteCatalog, sourceUrl),
    )
    await persistLookupRows(env.DB, refreshedRows)

    for (const row of refreshedRows) {
      cachedRows.set(row.matchKey, row)
    }
  }

  return {
    lookup: cachedRows,
    status: buildPricingStatus(normalizedRefs, sourceUrl, cachedRows),
  }
}

export function estimateProjectedCostUsd(input: {
  cacheReadInputTokens?: number
  inputTokens: number
  outputTokens: number
  pricing: ModelPricingLookupRow | undefined
}) {
  if (!input.pricing?.resolved) {
    return 0
  }

  return roundCurrency(
    input.inputTokens * input.pricing.inputCostPerToken +
      input.outputTokens * input.pricing.outputCostPerToken +
      (input.cacheReadInputTokens || 0) * input.pricing.cacheReadInputCostPerToken,
  )
}

export function getModelPricingLookupKey(model: string) {
  return normalizeModelKey(model)
}

async function loadCachedRows(
  db: D1Database,
  references: Array<ModelPricingReference & { matchKey: string }>,
) {
  const placeholders = references.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT match_key as matchKey,
              requested_model as requestedModel,
              source_model as sourceModel,
              source_provider as sourceProvider,
              input_cost_per_token as inputCostPerToken,
              output_cost_per_token as outputCostPerToken,
              cache_read_input_cost_per_token as cacheReadInputCostPerToken,
              resolved as resolved,
              fetched_at as fetchedAt,
              source_url as sourceUrl
       FROM model_pricing_cache
       WHERE match_key IN (${placeholders})`,
    )
    .bind(...references.map((reference) => reference.matchKey))
    .all<ModelPricingLookupRow>()

  return new Map(
    (result.results || []).map((row) => [
      row.matchKey,
      {
        ...row,
        cacheReadInputCostPerToken: toFiniteNumber(row.cacheReadInputCostPerToken),
        fetchedAt: toFiniteNumber(row.fetchedAt),
        inputCostPerToken: toFiniteNumber(row.inputCostPerToken),
        outputCostPerToken: toFiniteNumber(row.outputCostPerToken),
        resolved: Boolean(row.resolved),
      },
    ]),
  )
}

async function fetchRemoteCatalog(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Pricing refresh failed with ${response.status} from ${sourceUrl}`)
  }

  const json = (await response.json()) as Record<string, RemotePricingEntry>
  return Object.entries(json).map(([model, value]) => ({
    inputCostPerToken: toFiniteNumber(value.input_cost_per_token),
    normalizedKey: normalizeModelKey(model),
    outputCostPerToken: toFiniteNumber(value.output_cost_per_token),
    provider: value.litellm_provider || null,
    rawKey: model,
    resolved:
      Number.isFinite(value.input_cost_per_token) || Number.isFinite(value.output_cost_per_token),
    cacheReadInputCostPerToken: toFiniteNumber(value.cache_read_input_token_cost),
  }))
}

function buildLookupRow(
  reference: ModelPricingReference & { matchKey: string },
  catalog: Awaited<ReturnType<typeof fetchRemoteCatalog>>,
  sourceUrl: string,
): ModelPricingLookupRow {
  const matchedEntry = matchCatalogEntry(reference, catalog)
  const fetchedAt = Date.now()

  return {
    cacheReadInputCostPerToken: matchedEntry?.cacheReadInputCostPerToken || 0,
    fetchedAt,
    inputCostPerToken: matchedEntry?.inputCostPerToken || 0,
    matchKey: reference.matchKey,
    outputCostPerToken: matchedEntry?.outputCostPerToken || 0,
    requestedModel: reference.model,
    resolved: Boolean(matchedEntry?.resolved),
    sourceModel: matchedEntry?.rawKey || null,
    sourceProvider: matchedEntry?.provider || null,
    sourceUrl,
  }
}

function matchCatalogEntry(
  reference: ModelPricingReference & { matchKey: string },
  catalog: Awaited<ReturnType<typeof fetchRemoteCatalog>>,
) {
  const exactMatch = catalog.find((entry) => entry.normalizedKey === reference.matchKey)
  if (exactMatch) {
    return exactMatch
  }

  const providerHint = inferProviderHint(reference)
  const partialMatches = catalog
    .filter(
      (entry) =>
        entry.normalizedKey.includes(reference.matchKey) ||
        reference.matchKey.includes(entry.normalizedKey),
    )
    .sort((left, right) =>
      scoreCatalogEntry(right, reference.matchKey, providerHint) -
      scoreCatalogEntry(left, reference.matchKey, providerHint),
    )

  return partialMatches[0]
}

function scoreCatalogEntry(
  entry: Awaited<ReturnType<typeof fetchRemoteCatalog>>[number],
  requestedKey: string,
  providerHint: string | null,
) {
  let score = 0

  if (entry.normalizedKey.startsWith(requestedKey)) {
    score += 60
  }

  if (entry.normalizedKey.includes(requestedKey)) {
    score += 30
  }

  if (providerHint && entry.provider === providerHint) {
    score += 20
  }

  score -= Math.max(0, entry.normalizedKey.length - requestedKey.length)
  return score
}

function inferProviderHint(reference: ModelPricingReference) {
  const combined = `${reference.provider || ''} ${reference.model}`.toLowerCase()
  if (combined.includes('claude')) {
    return 'anthropic'
  }
  if (combined.includes('gpt') || combined.includes('o1') || combined.includes('o3') || combined.includes('o4')) {
    return 'openai'
  }
  return null
}

async function persistLookupRows(db: D1Database, rows: ModelPricingLookupRow[]) {
  if (rows.length === 0) {
    return
  }

  await db.batch(
    rows.map((row) =>
      db
        .prepare(
          `INSERT INTO model_pricing_cache (
             match_key,
             requested_model,
             source_model,
             source_provider,
             input_cost_per_token,
             output_cost_per_token,
             cache_read_input_cost_per_token,
             resolved,
             fetched_at,
             source_url
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(match_key) DO UPDATE SET
             requested_model = excluded.requested_model,
             source_model = excluded.source_model,
             source_provider = excluded.source_provider,
             input_cost_per_token = excluded.input_cost_per_token,
             output_cost_per_token = excluded.output_cost_per_token,
             cache_read_input_cost_per_token = excluded.cache_read_input_cost_per_token,
             resolved = excluded.resolved,
             fetched_at = excluded.fetched_at,
             source_url = excluded.source_url`,
        )
        .bind(
          row.matchKey,
          row.requestedModel,
          row.sourceModel,
          row.sourceProvider,
          row.inputCostPerToken,
          row.outputCostPerToken,
          row.cacheReadInputCostPerToken,
          row.resolved ? 1 : 0,
          row.fetchedAt,
          row.sourceUrl,
        ),
    ),
  )
}

function dedupeReferences(references: ModelPricingReference[]) {
  const seen = new Set<string>()
  const normalized: Array<ModelPricingReference & { matchKey: string }> = []

  for (const reference of references) {
    const matchKey = normalizeModelKey(reference.model)
    if (!matchKey || seen.has(matchKey)) {
      continue
    }
    seen.add(matchKey)
    normalized.push({ ...reference, matchKey })
  }

  return normalized
}

function buildPricingStatus(
  references: Array<ModelPricingReference & { matchKey: string }>,
  sourceUrl: string,
  cachedRows?: Map<string, ModelPricingLookupRow>,
): DashboardPricingStatus {
  const totalTokens = references.reduce((sum, reference) => sum + (reference.tokens || 0), 0)
  const coveredReferences = references.filter((reference) => cachedRows?.get(reference.matchKey)?.resolved)
  const coveredTokens = coveredReferences.reduce(
    (sum, reference) => sum + (reference.tokens || 0),
    0,
  )
  const lastRefreshedAt = cachedRows
    ? [...cachedRows.values()].reduce<number | null>((latest, row) => {
        if (!row.fetchedAt) {
          return latest
        }
        return latest === null ? row.fetchedAt : Math.max(latest, row.fetchedAt)
      }, null)
    : null

  return {
    coverageRatio: totalTokens > 0 ? coveredTokens / totalTokens : 0,
    coveredModelCount: coveredReferences.length,
    coveredTokens,
    lastRefreshedAt: lastRefreshedAt ? new Date(lastRefreshedAt).toISOString() : null,
    sourceLabel: DEFAULT_SOURCE_LABEL,
    sourceUrl,
    totalModelCount: references.length,
    totalTokens,
  }
}

function normalizeModelKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getRefreshIntervalMs(env: CloudflareAppEnv) {
  const hours = Number(env.PUBLIC_MODEL_PRICING_REFRESH_HOURS)
  if (Number.isFinite(hours) && hours > 0) {
    return hours * 60 * 60 * 1000
  }
  return DEFAULT_REFRESH_INTERVAL_MS
}

function toFiniteNumber(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}
