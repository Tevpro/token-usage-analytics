export type TrafficChartPoint = {
  day: string
  primary: number
  secondary: number
  tertiary: number
}

export type AggregatedTrafficChartPoint = TrafficChartPoint & {
  endDay: string
  startDay: string
}

export type DualMetricChartPoint = {
  day: string
  primary: number
  secondary: number
}

export type SingleMetricChartPoint = {
  day: string
  value: number
}

export function aggregateTrafficChartPoints(data: TrafficChartPoint[], targetBucketCount = 12): AggregatedTrafficChartPoint[] {
  if (data.length <= targetBucketCount) {
    return data.map((point) => ({ ...point, endDay: point.day, startDay: point.day }))
  }

  const chunkSize = Math.max(1, Math.ceil(data.length / targetBucketCount))
  const aggregated: AggregatedTrafficChartPoint[] = []

  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.slice(index, index + chunkSize)

    if (chunk.length === 0) {
      continue
    }

    const totalRequests = chunk.reduce((sum, item) => sum + item.primary, 0)
    const averageCachedShare =
      totalRequests > 0
        ? chunk.reduce((sum, item) => sum + item.primary * item.tertiary, 0) / totalRequests
        : chunk.reduce((sum, item) => sum + item.tertiary, 0) / chunk.length

    aggregated.push({
      day: chunk[chunk.length - 1].day,
      endDay: chunk[chunk.length - 1].day,
      primary: chunk.reduce((sum, item) => sum + item.primary, 0),
      secondary: chunk.reduce((sum, item) => sum + item.secondary, 0),
      startDay: chunk[0].day,
      tertiary: Math.round(averageCachedShare),
    })
  }

  return aggregated
}

export function aggregateDualMetricChartPoints(data: DualMetricChartPoint[], targetBucketCount = 8): DualMetricChartPoint[] {
  if (data.length <= targetBucketCount) {
    return data
  }

  const chunkSize = Math.max(1, Math.ceil(data.length / targetBucketCount))
  const aggregated: DualMetricChartPoint[] = []

  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.slice(index, index + chunkSize)

    if (chunk.length === 0) {
      continue
    }

    aggregated.push({
      day: chunk[chunk.length - 1].day,
      primary: chunk.reduce((sum, item) => sum + item.primary, 0),
      secondary: chunk.reduce((sum, item) => sum + item.secondary, 0),
    })
  }

  return aggregated
}

export function aggregateSingleMetricChartPoints(data: SingleMetricChartPoint[], targetBucketCount = 8): SingleMetricChartPoint[] {
  if (data.length <= targetBucketCount) {
    return data
  }

  const chunkSize = Math.max(1, Math.ceil(data.length / targetBucketCount))
  const aggregated: SingleMetricChartPoint[] = []

  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.slice(index, index + chunkSize)

    if (chunk.length === 0) {
      continue
    }

    aggregated.push({
      day: chunk[chunk.length - 1].day,
      value: chunk.reduce((sum, item) => sum + item.value, 0),
    })
  }

  return aggregated
}
