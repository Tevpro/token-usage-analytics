export type CloudflareAppEnv = {
  APP_ENV?: string
  DASHBOARD_WORKSPACE_SLUG?: string
  DB: D1Database
  INGEST_SHARED_SECRET?: string
  OPENAI_API_KEY?: string
  OPENAI_USAGE_DAYS_BACK?: string
  OPENAI_USAGE_ENVIRONMENT?: string
  OPENAI_USAGE_WORKSPACE_NAME?: string
  OPENAI_USAGE_WORKSPACE_SLUG?: string
}

export type AppRequestContext = {
  cloudflare: {
    ctx: ExecutionContext
    env: CloudflareAppEnv
  }
}
