import { captureDailyPricingForKnownModels } from '#/lib/public-model-pricing'
import type { CloudflareAppEnv } from '#/lib/runtime'

export function scheduleDailyPricingCapture(
  env: CloudflareAppEnv,
  ctx: ExecutionContext,
  capture: (
    env: CloudflareAppEnv,
  ) => Promise<unknown> = captureDailyPricingForKnownModels,
) {
  ctx.waitUntil(capture(env))
}
