import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { scheduleDailyPricingCapture } from '#/lib/pricing-schedule'

describe('daily pricing schedule', () => {
  it('uses the same explicit catalog source as the dashboard worker', () => {
    const sourceFrom = (path: string) =>
      readFileSync(path, 'utf8').match(
        /"PUBLIC_MODEL_PRICING_SOURCE_URL"\s*:\s*"([^"]+)"/,
      )?.[1]

    const dashboardSource = sourceFrom('wrangler.jsonc')
    const scheduledSource = sourceFrom('wrangler.pricing.jsonc')

    expect(dashboardSource).toBe(
      'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    )
    expect(scheduledSource).toBe(dashboardSource)
  })

  it('runs daily capture through waitUntil', async () => {
    const capture = Promise.resolve({
      availability: 'available' as const,
      rates: [],
      sourceUrl: 'test',
    })
    let scheduled: Promise<unknown> | undefined
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        scheduled = promise
      },
    } as unknown as ExecutionContext
    const env = { DB: {} as D1Database }

    scheduleDailyPricingCapture(env, ctx, () => capture)

    expect(scheduled).toBe(capture)
    await expect(scheduled).resolves.toMatchObject({
      availability: 'available',
    })
  })
})
