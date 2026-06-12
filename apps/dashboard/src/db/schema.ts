import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    errorCount: integer('error_count').notNull().default(0),
    avgLatencyMs: integer('avg_latency_ms').notNull(),
    p95LatencyMs: integer('p95_latency_ms').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('daily_usage_rollups_workspace_date_idx').on(table.workspaceId, table.usageDate),
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
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
  },
  (table) => [index('model_daily_usage_rollup_idx').on(table.rollupId)],
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
    index('issue_events_workspace_date_idx').on(table.workspaceId, table.usageDate),
    index('issue_events_severity_idx').on(table.severity),
  ],
)

export const modelPricingCache = sqliteTable(
  'model_pricing_cache',
  {
    matchKey: text('match_key').primaryKey(),
    requestedModel: text('requested_model').notNull(),
    sourceModel: text('source_model'),
    sourceProvider: text('source_provider'),
    inputCostPerToken: real('input_cost_per_token'),
    outputCostPerToken: real('output_cost_per_token'),
    cacheReadInputCostPerToken: real('cache_read_input_cost_per_token'),
    resolved: integer('resolved').notNull().default(0),
    fetchedAt: integer('fetched_at').notNull(),
    sourceUrl: text('source_url').notNull(),
  },
  (table) => [index('model_pricing_cache_fetched_at_idx').on(table.fetchedAt)],
)
