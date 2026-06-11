import { describe, expect, it } from 'vitest'

import {
  aggregateDualMetricChartPoints,
  aggregateSingleMetricChartPoints,
  aggregateTrafficChartPoints,
} from '#/lib/chart-presentation'

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
      missing: false,
      primary: 3,
      secondary: 6,
      startDay: '2026-05-28T00:00:00Z',
      tertiary: 67,
    })
    expect(aggregated[11]).toEqual({
      day: '2026-05-28T23:00:00Z',
      endDay: '2026-05-28T23:00:00Z',
      missing: false,
      primary: 47,
      secondary: 94,
      startDay: '2026-05-28T22:00:00Z',
      tertiary: 51,
    })
  })
})

describe('aggregateDualMetricChartPoints', () => {
  it('compresses 24 points into 8 grouped points', () => {
    const input = Array.from({ length: 24 }, (_, index) => ({
      day: `2026-05-${String(index + 1).padStart(2, '0')}`,
      primary: index + 1,
      secondary: (index + 1) * 10,
    }))

    const aggregated = aggregateDualMetricChartPoints(input)

    expect(aggregated).toHaveLength(8)
    expect(aggregated[0]).toEqual({ day: '2026-05-03', missing: false, primary: 6, secondary: 60 })
    expect(aggregated[7]).toEqual({ day: '2026-05-24', missing: false, primary: 69, secondary: 690 })
  })

  it('preserves missing-only chunks when aggregating compact chart data', () => {
    const input = [
      { day: '2026-06-01', missing: false, primary: 10, secondary: 4 },
      { day: '2026-06-02', missing: false, primary: 12, secondary: 5 },
      { day: '2026-06-03', missing: true, primary: 0, secondary: 0 },
      { day: '2026-06-04', missing: true, primary: 0, secondary: 0 },
    ]

    expect(aggregateDualMetricChartPoints(input, 2)).toEqual([
      { day: '2026-06-02', missing: false, primary: 22, secondary: 9 },
      { day: '2026-06-04', missing: true, primary: 0, secondary: 0 },
    ])
  })
})

describe('aggregateSingleMetricChartPoints', () => {
  it('compresses 14 points into 7 grouped values when requested', () => {
    const input = Array.from({ length: 14 }, (_, index) => ({
      day: `2026-06-${String(index + 1).padStart(2, '0')}`,
      value: index + 1,
    }))

    const aggregated = aggregateSingleMetricChartPoints(input, 7)

    expect(aggregated).toHaveLength(7)
    expect(aggregated[0]).toEqual({ day: '2026-06-02', missing: false, value: 3 })
    expect(aggregated[6]).toEqual({ day: '2026-06-14', missing: false, value: 27 })
  })
})
