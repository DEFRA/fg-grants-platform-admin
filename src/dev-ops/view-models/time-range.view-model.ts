import Joi from 'joi'

import { formatDate, formatRange } from '../views/components/nunjucks.ts'
import {
  fromZonedInput,
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  toValidDate,
  toZonedInput
} from './event-formats.ts'
import type { Zone, ZonedEdge } from './event-formats.ts'
import { present } from './list-filters.ts'

export interface TimeRangeQuery {
  from?: string
  to?: string
  range?: string
}

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** A calendar day, as the range chip's calendar and its From/To boxes send it. */
const isoDay = /^\d{4}-\d{2}-\d{2}$/

/** A box may or may not carry seconds; `fromZonedInput` takes the full wall clock. */
const toWallClock = (value: string, seconds: string | undefined): string =>
  `${value}${seconds ? '' : ':00'}`

const toUtcDate = (value: string, seconds: string | undefined): Date =>
  new Date(`${toWallClock(value, seconds)}Z`)

/** `2026-02-30` silently rolls forward; an impossible month throws. Check both. */
const isRealDatetime = (
  value: string,
  seconds: string | undefined
): boolean => {
  const date = toUtcDate(value, seconds)

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(seconds ? value : `${value}:00`)
  )
}

const isRealDay = (value: string): boolean =>
  isRealDatetime(`${value}T00:00`, undefined)

/** Anything not shaped like a day or a wall clock is an instant, checked where it is read. */
const isWallClockOk = (value: string): boolean => {
  const match = datetimeLocal.exec(value)

  return match === null || isRealDatetime(value, match[1])
}

const isRealBox = (value: string): boolean =>
  isoDay.test(value) ? isRealDay(value) : isWallClockOk(value)

const rangeBox = Joi.string()
  .allow('')
  .custom((value: string, helpers) =>
    isRealBox(value) ? value : helpers.error('any.invalid')
  )

export const timeRangeFilters = {
  from: rangeBox,
  to: rangeBox,
  range: Joi.string().allow('')
}

/** A day starts at its first moment and ends at its last, on the clock the person reads times by. */
const dayEdges: Record<ZonedEdge, string> = {
  earliest: 'T00:00:00',
  latest: 'T23:59:59'
}

/** A wall clock the zone cannot be read at, like year 0, has no instant: the box stays as typed, unreadable. */
const toIsoOr = (value: string, instant: Date): string =>
  Number.isNaN(instant.getTime()) ? value : instant.toISOString()

const toClockInstant = (value: string, edge: ZonedEdge, zone: Zone): string => {
  const match = datetimeLocal.exec(value)

  return match === null || !isRealDatetime(value, match[1])
    ? value
    : toIsoOr(value, fromZonedInput(toWallClock(value, match[1]), edge, zone))
}

/** The last moment of a day is its last millisecond, as GAS compares `to` inclusively. */
const lastMs: Record<ZonedEdge, number> = { earliest: 0, latest: 999 }

const toDayEdge = (value: string, edge: ZonedEdge, zone: Zone): string =>
  isRealDay(value)
    ? toIsoOr(
        value,
        new Date(
          fromZonedInput(`${value}${dayEdges[edge]}`, edge, zone).getTime() +
            lastMs[edge]
        )
      )
    : value

/** What a box means: a day, or a wall clock, read in the person's zone; an instant is taken as it is. */
const toInstant = (
  value: string | undefined,
  edge: ZonedEdge,
  zone: Zone
): string | undefined => {
  if (!value) {
    return undefined
  }

  return isoDay.test(value)
    ? toDayEdge(value, edge, zone)
    : toClockInstant(value, edge, zone)
}

const weekDays = 7
const monthDays = 30

/** The components' quick ranges. */
const quickRanges: { key: string; text: string; minutes: number }[] = [
  { key: '1h', text: 'Last hour', minutes: minutesPerHour },
  { key: '24h', text: 'Last 24 hours', minutes: hoursPerDay * minutesPerHour },
  {
    key: '7d',
    text: 'Last 7 days',
    minutes: weekDays * hoursPerDay * minutesPerHour
  },
  {
    key: '30d',
    text: 'Last 30 days',
    minutes: monthDays * hoursPerDay * minutesPerHour
  }
]

/** A quick range in force: one the release has, open-ended. */
const toActiveRange = ({ from, to, range }: TimeRangeQuery) =>
  from && !to ? quickRanges.find(({ key }) => key === range) : undefined

const minutesBefore = (now: Date, minutes: number): string =>
  new Date(now.getTime() - minutes * msPerMinute).toISOString()

/**
 * The window as instants. A quick range is the span back from `now`, whatever
 * its link's `from` says, so a page opened from an old link still shows what
 * its name says; the calendar's days and times are read in the zone.
 */
export const toRangeInstants = (
  query: TimeRangeQuery,
  zone: Zone,
  now: Date
): Pick<TimeRangeQuery, 'from' | 'to'> => {
  const quick = toActiveRange(query)

  return quick
    ? { from: minutesBefore(now, quick.minutes) }
    : {
        ...present('from', toInstant(query.from, 'earliest', zone)),
        ...present('to', toInstant(query.to, 'latest', zone))
      }
}

/**
 * A list's range, as its address spells it, as instants. A later page, and
 * every page an address restores, reads its first page's pinned start as it
 * is, never back from now.
 */
export const toListWindow = (
  { from, to, range }: Record<string, string | string[] | undefined>,
  zone: Zone,
  now: Date,
  later = false
): Pick<TimeRangeQuery, 'from' | 'to'> =>
  toRangeInstants(
    { from, to, ...(later ? {} : { range }) } as TimeRangeQuery,
    zone,
    now
  )

/**
 * A quick range's start as its first page read it, so its later pages carry
 * that start rather than move it on; any other window is left as it is spelt.
 */
export const pinQuickRange = <Query extends TimeRangeQuery>(
  query: Query,
  now: Date
): Query => {
  const quick = toActiveRange(query)

  return quick ? { ...query, from: minutesBefore(now, quick.minutes) } : query
}

const toEdgeMs = (value: string | undefined, none: number): number =>
  value === undefined ? none : Date.parse(value)

/** Both edges are instants, and the window doesn't end before it starts. */
export const isReadableWindow = ({
  from,
  to
}: Pick<TimeRangeQuery, 'from' | 'to'>): boolean => {
  const start = toEdgeMs(from, -Infinity)
  const end = toEdgeMs(to, Infinity)

  return !Number.isNaN(start) && !Number.isNaN(end) && start <= end
}

const anyTime = 'Any time'

const dayOfInstant = (value: string, zone: Zone): string | undefined => {
  const date = toValidDate(value)

  return date ? toZonedInput(date, zone).slice(0, 10) : undefined
}

/** The day a box falls on in the zone: a wall clock is the zone's already; a value that is no instant is no day. */
const toDay = (value: string | undefined, zone: Zone): string | undefined => {
  if (!value) {
    return undefined
  }

  return isoDay.test(value) || datetimeLocal.test(value)
    ? value.slice(0, 10)
    : dayOfInstant(value, zone)
}

export interface RangeChoice {
  text: string
  href: string
  checked: boolean
}

export interface RangeChip {
  /** The chip's text, which the applied tag repeats. */
  text: string
  /** Nothing chosen, so no tag. */
  isSet: boolean
  start: string | undefined
  end: string | undefined
  presets: RangeChoice[]
  /** Today in the zone: nothing later can have been kept. */
  max: string
}

const toOneSided = (start: string | undefined, end: string | undefined) => {
  if (start) {
    return `From ${formatDate(start)}`
  }

  return end ? `Until ${formatDate(end)}` : anyTime
}

/** "3–9 Nov 2026", "From 3 Nov 2026", "Until 9 Nov 2026", a quick range's name or "Any time". */
const toRangeText = (
  query: TimeRangeQuery,
  start: string | undefined,
  end: string | undefined
): string => {
  const quick = toActiveRange(query)

  if (quick) {
    return quick.text
  }

  return start && end ? formatRange(start, end) : toOneSided(start, end)
}

/**
 * A list's time filter. `toHref` gives the list's own link with another
 * window, so every choice keeps the other filters.
 */
export const toRangeChip = (
  query: TimeRangeQuery,
  toHref: (window: TimeRangeQuery) => string,
  now: Date,
  zone: Zone
): RangeChip => {
  const quick = toActiveRange(query)
  const start = quick ? undefined : toDay(query.from, zone)
  const end = quick ? undefined : toDay(query.to, zone)
  const isSet = Boolean(query.from ?? query.to)

  return {
    text: toRangeText(query, start, end),
    isSet,
    start,
    end,
    presets: [
      { text: anyTime, href: toHref({}), checked: !isSet },
      ...quickRanges.map(({ key, text, minutes }) => ({
        text,
        href: toHref({
          from: minutesBefore(now, minutes),
          range: key
        }),
        checked: quick?.key === key
      }))
    ],
    max: toZonedInput(now, zone).slice(0, 10)
  }
}
