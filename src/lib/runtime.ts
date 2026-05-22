export type CloudflareAppEnv = {
  APP_ENV?: string
  DB: D1Database
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
