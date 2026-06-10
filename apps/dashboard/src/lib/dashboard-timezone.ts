export const DASHBOARD_TIME_ZONE = 'America/Chicago'
export const HOUSTON_TIME_ZONE = DASHBOARD_TIME_ZONE

function parseDayToUtcNoon(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

export function addDaysToIsoDay(day: string, days: number) {
  const next = parseDayToUtcNoon(day)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function formatHoustonDay(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
  }).format(parseDayToUtcNoon(value))
}

export function formatHoustonDayShort(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: DASHBOARD_TIME_ZONE,
  }).format(parseDayToUtcNoon(value))
}

export function formatHoustonTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: DASHBOARD_TIME_ZONE,
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date)
}
