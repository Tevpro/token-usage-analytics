import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const dailyUsageRollups = sqliteTable(
  'daily_usage_rollups',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(),
    environment: text('environment').notNull(),
    requests: integer('requests').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    actualCostUsd: real('actual_cost_usd'),
    actualCostObservedSessions: integer('actual_cost_observed_sessions')
      .notNull()
      .default(0),
    actualCostObservedTokens: integer('actual_cost_observed_tokens')
      .notNull()
      .default(0),
    errorCount: integer('error_count').notNull().default(0),
    avgLatencyMs: integer('avg_latency_ms').notNull(),
    p95LatencyMs: integer('p95_latency_ms').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('daily_usage_rollups_workspace_date_idx').on(
      table.workspaceId,
      table.usageDate,
    ),
    index('daily_usage_rollups_environment_idx').on(table.environment),
  ],
)

export const modelDailyUsage = sqliteTable(
  'model_daily_usage',
  {
    id: text('id').primaryKey(),
    rollupId: text('rollup_id')
      .notNull()
      .references(() => dailyUsageRollups.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    requests: integer('requests').notNull(),
    tokens: integer('tokens').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
  },
  (table) => [index('model_daily_usage_rollup_idx').on(table.rollupId)],
)

export const publicModelPricingDaily = sqliteTable(
  'public_model_pricing_daily',
  {
    effectiveDay: text('effective_day').notNull(),
    priceKey: text('price_key').notNull(),
    requestedProvider: text('requested_provider').notNull(),
    requestedModel: text('requested_model').notNull(),
    sourceProvider: text('source_provider'),
    sourceModel: text('source_model'),
    inputMicroUsdPerMtok: integer('input_micro_usd_per_mtok')
      .notNull()
      .default(0),
    outputMicroUsdPerMtok: integer('output_micro_usd_per_mtok')
      .notNull()
      .default(0),
    cacheReadMicroUsdPerMtok: integer('cache_read_micro_usd_per_mtok')
      .notNull()
      .default(0),
    cacheWriteMicroUsdPerMtok: integer('cache_write_micro_usd_per_mtok')
      .notNull()
      .default(0),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    fetchedAt: integer('fetched_at').notNull(),
    sourceUrl: text('source_url').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.effectiveDay, table.priceKey] }),
    index('public_model_pricing_daily_fetched_at_idx').on(table.fetchedAt),
  ],
)

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repositoryKey: text('repository_key').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('repositories_workspace_key_idx').on(
      table.workspaceId,
      table.repositoryKey,
    ),
    uniqueIndex('repositories_workspace_id_idx').on(
      table.workspaceId,
      table.id,
    ),
    index('repositories_workspace_idx').on(table.workspaceId),
  ],
)

export const repositoryDailyUsage = sqliteTable(
  'repository_daily_usage',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id'),
    usageDate: text('usage_date').notNull(),
    environment: text('environment').notNull(),
    attributionStatus: text('attribution_status', {
      enum: ['exact', 'cwd-derived', 'unknown'],
    }).notNull(),
    requests: integer('requests').notNull(),
    totalTokens: integer('total_tokens').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.repositoryId],
      foreignColumns: [repositories.workspaceId, repositories.id],
      name: 'repository_daily_usage_workspace_repository_fk',
    }).onDelete('cascade'),
    index('repository_daily_usage_workspace_date_repo_idx').on(
      table.workspaceId,
      table.usageDate,
      table.repositoryId,
    ),
  ],
)

export const repositoryModelDailyUsage = sqliteTable(
  'repository_model_daily_usage',
  {
    id: text('id').primaryKey(),
    repositoryRollupId: text('repository_rollup_id')
      .notNull()
      .references(() => repositoryDailyUsage.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    requests: integer('requests').notNull(),
    tokens: integer('tokens').notNull(),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
  },
  (table) => [
    index('repository_model_daily_usage_rollup_idx').on(
      table.repositoryRollupId,
    ),
  ],
)

export const toolDailyUsage = sqliteTable(
  'tool_daily_usage',
  {
    id: text('id').primaryKey(),
    rollupId: text('rollup_id')
      .notNull()
      .references(() => dailyUsageRollups.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    callCount: integer('call_count').notNull(),
    errorCount: integer('error_count').notNull().default(0),
  },
  (table) => [index('tool_daily_usage_rollup_idx').on(table.rollupId)],
)

export const issueEvents = sqliteTable(
  'issue_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    occurredAt: integer('occurred_at').notNull(),
    usageDate: text('usage_date').notNull(),
    severity: text('severity', {
      enum: ['low', 'medium', 'high'],
    }).notNull(),
    title: text('title').notNull(),
    count: integer('count').notNull(),
    metadataJson: text('metadata_json'),
  },
  (table) => [
    index('issue_events_workspace_date_idx').on(
      table.workspaceId,
      table.usageDate,
    ),
    index('issue_events_severity_idx').on(table.severity),
  ],
)
