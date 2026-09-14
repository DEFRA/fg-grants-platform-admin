import { config } from '../../common/config.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { toEventKeyPath } from '../repositories/events.repository.ts'

/** Named by meaning; the classes live in status-badge/template.njk, where Tailwind can see them. */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

/** The wall clock alone, in UTC: `10:16:05`. */
const utcClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

/** `1 Sep 08:18`: day-first from parts, with `en-US` months because `en-GB` writes `Sept`. */
const utcDayClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

const utcPrecise = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

const msPerSecond = 1000
const secondsPerMinute = 60
export const minutesPerHour = 60
export const hoursPerDay = 24
export const msPerMinute = msPerSecond * secondsPerMinute
const msPerDay = msPerMinute * minutesPerHour * hoursPerDay

const toRelative = (from: Date, now: Date): string => {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - from.getTime()) / msPerSecond)
  )

  if (seconds < secondsPerMinute) {
    return `${seconds}s ago`
  }

  const minutes = Math.round(seconds / secondsPerMinute)

  if (minutes < minutesPerHour) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / minutesPerHour)

  return hours < hoursPerDay
    ? `${hours}h ${minutes % minutesPerHour}m ago`
    : `${Math.floor(hours / hoursPerDay)}d ago`
}

export interface Timestamp {
  text: string
  title: string
}

export const none = '—'

/** Intl and `toISOString` throw on an unparseable date. */
export const toValidDate = (value: string): Date | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

/** The instant a developer pastes into a log query: `2026-06-16T10:00:00Z`. */
export const toAbsolute = (value: string): string | null =>
  toValidDate(value)?.toISOString().replace('.000', '') ?? null

/** Past a day the date replaces the seconds, so an old row cannot read as this morning. */
export const toClock = (date: Date, now: Date): string => {
  if (now.getTime() - date.getTime() <= msPerDay) {
    return utcClock.format(date)
  }

  const parts = Object.fromEntries(
    utcDayClock
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`
}

/** Never shortened by age: the detail page is read against logs. */
export const toPreciseInstant = (date: Date): string => {
  const parts = Object.fromEntries(
    utcPrecise
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second}.${ms}`
}

/** Relative on the page, the ISO instant on the title. */
export const toTimestamp = (value: string | null, now: Date): Timestamp => {
  const date = value === null ? null : toValidDate(value)

  if (date === null) {
    return { text: '-', title: '' }
  }

  return {
    text: toRelative(date, now),
    title: date.toISOString().replace('.000', '')
  }
}

/** No other filter, so a Dead letter page does not hide the rest; audit rows only find audit rows when included. */
export const toSearchHref = (value: string, includeAudit = false): string =>
  `/dev-ops/events?q=${encodeURIComponent(value)}${includeAudit ? '&audit=include' : ''}`

export const toSearchTitle = (value: string, noun: string): string =>
  `${value}\nShow every event with this ${noun}`

/** The shared CDP logs pattern, so one link shows the trace across every service. */
const indexPattern = 'e55f3890-5d4a-11ee-8f40-670c9b0b8093'

const traceWindowMs = 6 * minutesPerHour * secondsPerMinute * msPerSecond

/** Rison escapes with `!` and delimits with `'`; escaping both first keeps a hostile id inside the string. */
const toRisonString = (value: string): string =>
  encodeURIComponent(value.replace(/!/g, '!!').replace(/'/g, "!'"))

/** Six hours either side: wide enough for later retries, narrow enough to stay quick. */
const toTraceWindow = (createdAt: string) => {
  const created = toValidDate(createdAt)

  if (created === null) {
    return null
  }

  return {
    from: new Date(created.getTime() - traceWindowMs).toISOString(),
    to: new Date(created.getTime() + traceWindowMs).toISOString()
  }
}

const buildDiscoverHref = (
  base: string,
  kuery: string,
  createdAt: string
): string | null => {
  const window = toTraceWindow(createdAt)

  if (window === null) {
    return null
  }

  const columns = 'container_name,message,log.level,trace.id'

  return (
    `${base}/_dashboards/app/data-explorer/discover/#` +
    `?_a=(discover:(columns:!(${columns}),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:${indexPattern},view:discover))` +
    `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'${window.from}',to:'${window.to}'))` +
    `&_q=(filters:!(),query:(language:kuery,query:'${kuery}'))`
  )
}

/** `%22` is the kuery's double quote, url-encoded inside the single-quoted rison string. */
const toKuery = (field: string, value: string): string =>
  `${field}:%22${toRisonString(value)}%22`

export const toTraceHref = (event: {
  traceId: string | null
  createdAt: string
}): string | null => {
  const base = config.get('logs.explorerBaseUrl')

  if (!base) {
    return null
  }

  return event.traceId === null
    ? null
    : buildDiscoverHref(
        base,
        toKuery('trace.id', event.traceId),
        event.createdAt
      )
}

/** A tenth of a second, the resolution the `1.2s` spelling reports in. */
const decisecond = 10

/** `5h 34m` past an hour, so a backoff reads as a duration rather than a sum. */
const toDuration = (ms: number): string => {
  if (ms < msPerSecond) {
    return `${ms}ms`
  }

  // Rounded before the unit is chosen, so 59.97s reads as a minute, not `60.0s`.
  const tenths = Math.round((ms * decisecond) / msPerSecond)

  if (tenths < secondsPerMinute * decisecond) {
    return `${(tenths / decisecond).toFixed(1)}s`
  }

  const whole = Math.round(ms / msPerSecond)
  const minutes = Math.floor(whole / secondsPerMinute)

  return minutes < minutesPerHour
    ? `${minutes}m ${whole % secondsPerMinute}s`
    : `${Math.floor(minutes / minutesPerHour)}h ${minutes % minutesPerHour}m`
}

/** The gap between two instants, or null when either will not parse. */
export const toGap = (from: string, to: string): string | null => {
  const started = toValidDate(from)
  const finished = toValidDate(to)

  return started === null || finished === null
    ? null
    : toDuration(Math.max(0, finished.getTime() - started.getTime()))
}

export const toEventHref = (key: EventKey): string =>
  `/dev-ops/events/${toEventKeyPath(key)}`
