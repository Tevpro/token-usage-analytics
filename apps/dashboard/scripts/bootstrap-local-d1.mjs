import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const tempDir = path.join(projectRoot, '.wrangler', 'tmp')
const sqlFile = path.join(tempDir, 'bootstrap-local-d1.sql')
const wranglerBin = path.join(projectRoot, 'node_modules', '.bin', 'wrangler')
const databaseName = 'token_analytics'
const now = new Date()
const nowMs = now.getTime()
const gapDayOffset = 4
const totalDailyDays = 14
const totalHourlyHours = 24

const workspaces = [
  {
    baseCost: 3.6,
    baseRequests: 42,
    id: 'workspace:atlas',
    name: 'Atlas Production',
    provider: 'Hermes',
    slug: 'atlas',
  },
  {
    baseCost: 2.2,
    baseRequests: 28,
    id: 'workspace:ops-lab',
    name: 'Ops Lab',
    provider: 'OpenAI',
    slug: 'ops-lab',
  },
]

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  })
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function utcDay(offsetDays = 0) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function utcHour(offsetHours = 0) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()))
  date.setUTCHours(date.getUTCHours() + offsetHours, 0, 0, 0)
  return date.toISOString().slice(0, 19) + 'Z'
}

function rollupInsert({
  avgLatencyMs,
  cachedTokens,
  cost,
  createdAt,
  day,
  environment,
  errorCount,
  id,
  inputTokens,
  outputTokens,
  p95LatencyMs,
  requests,
  totalTokens,
  workspaceId,
}) {
  return `INSERT INTO daily_usage_rollups (id, workspace_id, usage_date, environment, requests, total_tokens, input_tokens, output_tokens, cached_tokens, estimated_cost_usd, error_count, avg_latency_ms, p95_latency_ms, created_at) VALUES (${quote(id)}, ${quote(workspaceId)}, ${quote(day)}, ${quote(environment)}, ${requests}, ${totalTokens}, ${inputTokens}, ${outputTokens}, ${cachedTokens}, ${cost.toFixed(4)}, ${errorCount}, ${avgLatencyMs}, ${p95LatencyMs}, ${createdAt});`
}

function modelInsert({ id, rollupId, model, provider, requests, tokens, cost }) {
  return `INSERT INTO model_daily_usage (id, rollup_id, model, provider, requests, tokens, estimated_cost_usd) VALUES (${quote(id)}, ${quote(rollupId)}, ${quote(model)}, ${quote(provider)}, ${requests}, ${tokens}, ${cost.toFixed(4)});`
}

function toolInsert({ id, rollupId, toolName, callCount, errorCount }) {
  return `INSERT INTO tool_daily_usage (id, rollup_id, tool_name, call_count, error_count) VALUES (${quote(id)}, ${quote(rollupId)}, ${quote(toolName)}, ${callCount}, ${errorCount});`
}

function issueInsert({ id, workspaceId, occurredAt, usageDate, severity, title, count, metadata }) {
  const metadataValue = metadata ? quote(JSON.stringify(metadata)) : 'NULL'
  return `INSERT INTO issue_events (id, workspace_id, occurred_at, usage_date, severity, title, count, metadata_json) VALUES (${quote(id)}, ${quote(workspaceId)}, ${occurredAt}, ${quote(usageDate)}, ${quote(severity)}, ${quote(title)}, ${count}, ${metadataValue});`
}

function buildDailyRows(workspace) {
  const statements = []

  for (let daysAgo = totalDailyDays - 1; daysAgo >= 0; daysAgo -= 1) {
    if (daysAgo === gapDayOffset) {
      continue
    }

    const day = utcDay(-daysAgo)
    const dayIndex = totalDailyDays - 1 - daysAgo
    const trafficSwing = dayIndex % 5
    const requests = workspace.baseRequests + dayIndex * 3 + trafficSwing * 2
    const inputTokens = requests * (110 + (dayIndex % 4) * 7)
    const outputTokens = requests * (52 + (dayIndex % 3) * 5)
    const cachedTokens = Math.round(inputTokens * (0.12 + (dayIndex % 3) * 0.04))
    const totalTokens = inputTokens + outputTokens
    const cost = workspace.baseCost + dayIndex * 0.42 + trafficSwing * 0.18
    const errorCount = dayIndex === totalDailyDays - 3 ? 3 : dayIndex % 6 === 0 ? 1 : 0
    const avgLatencyMs = 620 + dayIndex * 14 + trafficSwing * 11
    const p95LatencyMs = avgLatencyMs + 340 + dayIndex * 8
    const rollupId = `${workspace.id}:${day}`
    const createdAt = nowMs - daysAgo * 24 * 60 * 60 * 1000

    statements.push(
      rollupInsert({
        avgLatencyMs,
        cachedTokens,
        cost,
        createdAt,
        day,
        environment: 'production',
        errorCount,
        id: rollupId,
        inputTokens,
        outputTokens,
        p95LatencyMs,
        requests,
        totalTokens,
        workspaceId: workspace.id,
      }),
    )

    const primaryModel = workspace.provider === 'OpenAI' ? 'gpt-5.4' : 'claude-sonnet-4'
    const secondaryModel = workspace.provider === 'OpenAI' ? 'gpt-4.1-mini' : 'gpt-5.4-mini'
    const primaryTokens = Math.round(totalTokens * 0.68)
    const secondaryTokens = totalTokens - primaryTokens
    const primaryRequests = Math.max(1, Math.round(requests * 0.62))
    const secondaryRequests = Math.max(1, requests - primaryRequests)

    statements.push(
      modelInsert({
        cost: cost * 0.72,
        id: `${rollupId}:model:primary`,
        model: primaryModel,
        provider: workspace.provider,
        requests: primaryRequests,
        rollupId,
        tokens: primaryTokens,
      }),
    )
    statements.push(
      modelInsert({
        cost: cost * 0.28,
        id: `${rollupId}:model:secondary`,
        model: secondaryModel,
        provider: workspace.provider,
        requests: secondaryRequests,
        rollupId,
        tokens: secondaryTokens,
      }),
    )

    statements.push(
      toolInsert({
        callCount: Math.max(4, Math.round(requests * 0.55)),
        errorCount: errorCount > 0 ? 1 : 0,
        id: `${rollupId}:tool:web-search`,
        rollupId,
        toolName: 'web_search',
      }),
    )
    statements.push(
      toolInsert({
        callCount: Math.max(2, Math.round(requests * 0.34)),
        errorCount: 0,
        id: `${rollupId}:tool:file-read`,
        rollupId,
        toolName: 'read_file',
      }),
    )

    if (dayIndex === totalDailyDays - 3) {
      statements.push(
        issueInsert({
          count: 1,
          id: `${workspace.id}:${day}:token-spike`,
          metadata: { previousGap: false, totalTokens },
          occurredAt: createdAt,
          severity: 'high',
          title: 'Token volume jumped sharply day over day',
          usageDate: day,
          workspaceId: workspace.id,
        }),
      )
    }

    if (dayIndex === totalDailyDays - 6) {
      statements.push(
        issueInsert({
          count: 2,
          id: `${workspace.id}:${day}:cache-drop`,
          metadata: { cachedTokens, inputTokens },
          occurredAt: createdAt,
          severity: 'medium',
          title: 'Cache hit rate fell below expected baseline',
          usageDate: day,
          workspaceId: workspace.id,
        }),
      )
    }
  }

  return statements
}

function buildHourlyRows(workspace) {
  const statements = []

  for (let hoursAgo = totalHourlyHours - 1; hoursAgo >= 0; hoursAgo -= 1) {
    const timestamp = utcHour(-hoursAgo)
    const hourIndex = totalHourlyHours - 1 - hoursAgo
    const burst = hourIndex >= 18 ? 1.35 : hourIndex <= 5 ? 0.7 : 1
    const requests = Math.max(1, Math.round((workspace.baseRequests / 8 + (hourIndex % 4)) * burst))
    const inputTokens = requests * (48 + (hourIndex % 3) * 6)
    const outputTokens = requests * (20 + (hourIndex % 2) * 4)
    const cachedTokens = Math.round(inputTokens * (0.08 + (hourIndex % 4) * 0.03))
    const totalTokens = inputTokens + outputTokens
    const cost = Number((workspace.baseCost / 10 + hourIndex * 0.035 * burst).toFixed(4))
    const errorCount = hourIndex === 21 ? 1 : 0
    const avgLatencyMs = 410 + hourIndex * 6
    const p95LatencyMs = avgLatencyMs + 180
    const rollupId = `${workspace.id}:${timestamp}`
    const createdAt = nowMs - hoursAgo * 60 * 60 * 1000

    statements.push(
      rollupInsert({
        avgLatencyMs,
        cachedTokens,
        cost,
        createdAt,
        day: timestamp,
        environment: 'production',
        errorCount,
        id: rollupId,
        inputTokens,
        outputTokens,
        p95LatencyMs,
        requests,
        totalTokens,
        workspaceId: workspace.id,
      }),
    )

    statements.push(
      modelInsert({
        cost: cost * 0.64,
        id: `${rollupId}:model:primary`,
        model: workspace.provider === 'OpenAI' ? 'gpt-5.4' : 'claude-sonnet-4',
        provider: workspace.provider,
        requests: Math.max(1, Math.round(requests * 0.6)),
        rollupId,
        tokens: Math.round(totalTokens * 0.67),
      }),
    )
    statements.push(
      modelInsert({
        cost: cost * 0.36,
        id: `${rollupId}:model:secondary`,
        model: workspace.provider === 'OpenAI' ? 'gpt-4.1-mini' : 'gpt-5.4-mini',
        provider: workspace.provider,
        requests: Math.max(1, requests - Math.round(requests * 0.6)),
        rollupId,
        tokens: totalTokens - Math.round(totalTokens * 0.67),
      }),
    )

    statements.push(
      toolInsert({
        callCount: Math.max(1, Math.round(requests * 0.5)),
        errorCount: errorCount > 0 ? 1 : 0,
        id: `${rollupId}:tool:web-search`,
        rollupId,
        toolName: 'web_search',
      }),
    )
  }

  return statements
}

function buildSql() {
  const statements = [
    '-- Local dashboard bootstrap seed',
    '-- Generated by scripts/bootstrap-local-d1.mjs',
    'PRAGMA foreign_keys = ON;',
    `DELETE FROM workspaces WHERE id IN (${workspaces.map((workspace) => quote(workspace.id)).join(', ')});`,
  ]

  for (const workspace of workspaces) {
    statements.push(
      `INSERT INTO workspaces (id, slug, name, provider, created_at, last_ingested_at) VALUES (${quote(workspace.id)}, ${quote(workspace.slug)}, ${quote(workspace.name)}, ${quote(workspace.provider)}, ${nowMs}, ${nowMs});`,
    )
    statements.push(...buildDailyRows(workspace))
    statements.push(...buildHourlyRows(workspace))
  }

  return statements.join('\n') + '\n'
}

mkdirSync(tempDir, { recursive: true })
writeFileSync(sqlFile, buildSql())

console.log('Applying local D1 migrations...')
run('npm', ['run', 'cf:d1:migrate:local'])
console.log('Seeding local D1 demo data...')
run(wranglerBin, ['d1', 'execute', databaseName, '--local', '--file', sqlFile])
console.log('Verifying local D1 seed summary...')
run(wranglerBin, [
  'd1',
  'execute',
  databaseName,
  '--local',
  '--command',
  'SELECT COUNT(*) AS workspaces FROM workspaces; SELECT COUNT(*) AS rollups FROM daily_usage_rollups; SELECT COUNT(*) AS model_rows FROM model_daily_usage; SELECT COUNT(*) AS tool_rows FROM tool_daily_usage; SELECT COUNT(*) AS issues FROM issue_events;',
])
console.log('\nLocal D1 bootstrap complete. You can now run `npm run dev`.')
