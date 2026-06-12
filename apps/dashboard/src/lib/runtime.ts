export type CloudflareAppEnv = {
  APP_ENV?: string
  DASHBOARD_WORKSPACE_SLUG?: string
  DB: D1Database
  HERMES_TOKEN_ANALYTICS_SHARED_SECRET?: string
  INGEST_SHARED_SECRET?: string
  OPENAI_API_KEY?: string
  OPENAI_USAGE_DAYS_BACK?: string
  OPENAI_USAGE_ENVIRONMENT?: string
  OPENAI_USAGE_WORKSPACE_NAME?: string
  OPENAI_USAGE_WORKSPACE_SLUG?: string
  PUBLIC_MODEL_PRICING_REFRESH_HOURS?: string
  PUBLIC_MODEL_PRICING_SOURCE_URL?: string
}

export type AppRequestContext = {
  cloudflare: {
    ctx: ExecutionContext
    env: CloudflareAppEnv
  }
}
