import { scheduleDailyPricingCapture } from '#/lib/pricing-schedule'
import type { CloudflareAppEnv } from '#/lib/runtime'

export default {
  scheduled(
    _controller: ScheduledController,
    env: CloudflareAppEnv,
    ctx: ExecutionContext,
  ) {
    scheduleDailyPricingCapture(env, ctx)
  },
} satisfies ExportedHandler<CloudflareAppEnv>
