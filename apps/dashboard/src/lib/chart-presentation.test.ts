import { describe, expect, it } from 'vitest'

import { aggregateTrafficChartPoints } from '#/lib/chart-presentation'

describe('aggregateTrafficChartPoints', () => {
  it('keeps 12 or fewer points unchanged', () => {
    const input = [
      { day: '2026-05-28T06:00:00Z', primary: 4, secondary: 3, tertiary: 10 },
      { day: '2026-05-28T07:00:00Z', primary: 8, secondary: 5, tertiary: 40 },
    ]

    expect(aggregateTrafficChartPoints(input)).toEqual([
      { day: '2026-05-28T06:00:00Z', endDay: '2026-05-28T06:00:00Z', primary: 4, secondary: 3, startDay: '2026-05-28T06:00:00Z', tertiary: 10 },
      { day: '2026-05-28T07:00:00Z', endDay: '2026-05-28T07:00:00Z', primary: 8, secondary: 5, startDay: '2026-05-28T07:00:00Z', tertiary: 40 },
    ])
  })

  it('compresses 24 hourly points into 12 grouped bars with weighted cache share', () => {
    const input = Array.from({ length: 24 }, (_, index) => ({
      day: `2026-05-28T${String(index).padStart(2, '0')}:00:00Z`,
      primary: index + 1,
      secondary: (index + 1) * 2,
      tertiary: index % 2 === 0 ? 0 : 100,
    }))

    const aggregated = aggregateTrafficChartPoints(input)

    expect(aggregated).toHaveLength(12)
    expect(aggregated[0]).toEqual({
      day: '2026-05-28T01:00:00Z',
      endDay: '2026-05-28T01:00:00Z',
      primary: 3,
      secondary: 6,
      startDay: '2026-05-28T00:00:00Z',
      tertiary: 67,
    })
    expect(aggregated[11]).toEqual({
      day: '2026-05-28T23:00:00Z',
      endDay: '2026-05-28T23:00:00Z',
      primary: 47,
      secondary: 94,
      startDay: '2026-05-28T22:00:00Z',
      tertiary: 51,
    })
  })
})
