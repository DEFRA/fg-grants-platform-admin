import { config } from '../../common/config.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { toEventKeyPath } from '../repositories/events.repository.ts'

/**
 * The vocabulary the events list and the single-event page share: what
 * fg-gas-backend cannot answer for this app — how an instant reads against
 * the clock right now, and where a link goes. What one page shapes for itself
 * (truncation widths, tooltip stacking) stays out.
 */

/**
 * The status roles these pages use, named by meaning rather than by class. Each
 * one is a colour of dot and a weight of label; the literal classes live in
 * status-badge/template.njk, because Tailwind scans views/ for candidates and a
 * class name spelled only in TypeScript is purged from the stylesheet without a
 * word of warning.
 */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

/** The wall clock alone, in UTC: `10:16:05`. */
const utcClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

/**
 * The same clock with the day in front of it: `1 Sep 08:18`. Assembled from
 * parts rather than formatted whole: the order is day-first, which `en-US`
 * does not write, but the three-letter month is `en-US`'s — `en-GB` spells
 * September `Sept`, and a column of months that is three characters wide
 * except in one month is a column that jumps.
 */
const utcDayClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
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

/**
 * The one spelling of "there is no value here", shared by every surface that
 * has to draw the absence of one: an empty fact on the event page, and a
 * failure group the backend recorded no message for. The event template
 * compares against it to pick the muted register, so a private sentinel here
 * would let one character silently change how those cells read.
 */
export const none = '—'

/** Nothing to say, and nothing to hover: a row that has never failed. */
export const noTimestamp: Timestamp = {
  text: '-',
  title: 'No failure recorded'
}

/** The instant a developer pastes into a log query: `2026-06-16T10:00:00Z`. */
export const toAbsolute = (value: string): string | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().replace('.000', '')
}

/** The instant whole, milliseconds and all: what a copy button carries. */
export const toIso = (value: string): string | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The second line of a Created cell. One keyset window is almost always one
 * day, so the date is not worth a column — but `08:18:01` on a row from last
 * Tuesday reads as this morning, and a page filtered to Dead letter is
 * exactly the page whose rows are old. Past twenty-four hours the day arrives
 * and the seconds go; the whole instant stays on the title.
 */
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

/**
 * Relative on the page, absolute in the tooltip: a relative time alone is
 * unquotable and a stale tab makes it a lie, so the title carries the one
 * ISO-UTC spelling every other surface states.
 */
export const toTimestamp = (value: string, now: Date): Timestamp => {
  const date = new Date(value)

  // Intl throws on an unparseable date; a dash is more use than a 500.
  if (Number.isNaN(date.getTime())) {
    return { text: '-', title: '' }
  }

  return {
    text: toRelative(date, now),
    // The date proved parseable above, so toAbsolute cannot return null here.
    title: toAbsolute(value) ?? ''
  }
}

/**
 * The pair-finding link: this value, and deliberately no other filter at all —
 * an operator clicking a reference is asking "where else did this go?", and
 * they are usually asking from a page filtered to Dead letter, the one filter
 * guaranteed to hide the healthy hops they are looking for. Used for the
 * REFERENCE only: Mongo's unique constraint means `?q=<event id>` could only
 * ever answer with the one row the operator was already looking at.
 */
export const toSearchHref = (value: string): string =>
  `/dev-ops/events?q=${encodeURIComponent(value)}`

/**
 * The whole value, then what clicking it does: a token that suddenly
 * navigates has to say so before it is clicked.
 */
export const toSearchTitle = (value: string, noun: string): string =>
  `${value}\nShow every event with this ${noun}`

/**
 * The index pattern the Discover link resolves against — the shared CDP logs
 * pattern, taken from a working Discover url. The link deliberately opens
 * plain Discover on this pattern rather than a per-service saved search, so
 * one click shows the trace across every service that logged it; the
 * `container_name` column says which service wrote each line.
 */
const indexPattern = 'e55f3890-5d4a-11ee-8f40-670c9b0b8093'

const traceWindowMs = 6 * minutesPerHour * secondsPerMinute * msPerSecond

/**
 * Rison, the encoding OpenSearch uses for `_a`/`_g`/`_q`, treats `!` as its
 * escape character and `'` as a string delimiter, so both are escaped before
 * anything else touches the value. `encodeURIComponent` then makes the result
 * url-safe without disturbing either — it leaves `!` and `'` alone — so a
 * hostile trace id can neither close the rison string nor escape the href.
 */
const toRisonString = (value: string): string =>
  encodeURIComponent(value.replace(/!/g, '!!').replace(/'/g, "!'"))

/**
 * Six hours either side of the event. Wide enough that a retry an hour later
 * is still on screen, narrow enough that the query stays quick.
 */
const toTraceWindow = (createdAt: string) => {
  const created = new Date(createdAt)

  // A date the endpoint wrote that we cannot parse leaves no window to search,
  // and a link to `Invalid Date` is worse than no link.
  if (Number.isNaN(created.getTime())) {
    return null
  }

  return {
    from: new Date(created.getTime() - traceWindowMs).toISOString(),
    to: new Date(created.getTime() + traceWindowMs).toISOString()
  }
}

/**
 * The Discover url, assembled by hand rather than through a rison library:
 * every dynamic part of it is one query and two timestamps, and the rest is a
 * fixed blob lifted from a working search.
 */
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

/**
 * A field matched exactly. `%22` is a literal here — the kuery is
 * `field:"<value>"`, and its double quotes have to survive as url-encoded
 * characters inside the single-quoted rison string that carries them.
 */
const toKuery = (field: string, value: string): string =>
  `${field}:%22${toRisonString(value)}%22`

/**
 * Null without both a configured logs explorer and a trace on the event. The
 * link is the same shape for every service — cross-service by design, so the
 * whole journey of a trace is one click.
 */
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

/**
 * Past an hour it reads `5h 34m` rather than `334m 0s`: a gap between two
 * delivery attempts is read to see the shape of a backoff, and a figure in
 * minutes with a trailing `0s` is a number to be divided rather than a
 * duration to be recognised.
 */
const toDuration = (ms: number): string => {
  if (ms < msPerSecond) {
    return `${ms}ms`
  }

  // Rounded to tenths *before* the unit is chosen, so 59.97 seconds is a
  // minute rather than the `60.0s` a later rounding would have printed.
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
  const started = new Date(from).getTime()
  const finished = new Date(to).getTime()

  return Number.isNaN(started) || Number.isNaN(finished)
    ? null
    : toDuration(Math.max(0, finished - started))
}

/**
 * The inspect page for one row, wherever it is linked from. The three segments
 * are the endpoint's own key for a message, and each is escaped: a service or
 * a box the page has never heard of is still only ever one path segment.
 */
export const toEventHref = (key: EventKey): string =>
  `/dev-ops/events/${toEventKeyPath(key)}`
