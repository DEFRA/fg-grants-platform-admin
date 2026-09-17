import { showsDeadLetterContent } from '../use-cases/dead-letter-page.ts'
import { toBoxLabel, toServiceLabel } from './event-labels.ts'
import { toEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { isDeadLetterStatus } from './event-state.ts'
import {
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  none,
  toClock,
  toEventHref,
  toTimestamp,
  toValidDate,
  toZonedInput
} from './event-formats.ts'
import type {
  EventBreakdownGroup,
  EventBreakdownPage,
  EventCounts,
  EventFacets,
  EventKey,
  EventRow as EventRowResponse,
  EventsPagination,
  EventsQuery,
  EventsResult,
  ServiceFilter,
  SourceError,
  StatusFilter
} from '../use-cases/get-events.use-case.ts'

export interface EventsPageQuery extends EventsQuery {
  range?: string
}

interface EventRow {
  eventHref: string
  eventId: string
  status: string
  statusLabel: string
  statusRole: EventRowResponse['statusRole']
  statusRetrying: boolean
  latency: string | null
  latencyTitle: string
  createdAt: string
  createdAtInstant: string
  createdAtPrecise: string
  createdAtClock: string
  eventName: EventName
  serviceLabel: string
  boxLabel: string
  isDeadLetter: boolean
}

interface ErrorNote {
  label: string
  title: string
  clearHref: string
}

interface TimeRangePreset {
  key: string
  label: string
  href: string
  title: string
  active: boolean
}

interface TimeRange {
  label: string
  title: string
  active: boolean
  presets: TimeRangePreset[]
  anyTimeHref: string
  anyTimeActive: boolean
}

interface FailureGroup {
  message: string
  messageTitle: string | null
  type: string
  eventName: EventName
  countLabel: string
  firstAt: string
  firstInstant: string
  firstPrecise: string
  lastAt: string
  lastInstant: string
  lastPrecise: string
  href: string | null
}

interface TopFailures {
  groups: FailureGroup[]
  summary: string
}

interface ServiceChip {
  value: string | null
  label: string
  href: string
  active: boolean
}

export interface FilterChip {
  value: string | null
  label: string
  href: string
  active: boolean
  countLabel: string | null
  zero: boolean
  alarming: boolean
  title: string | null
}

interface AuditSwitch {
  checked: boolean
  href: string
  label: string
  title: string
}

interface SearchFilter {
  name: string
  value: string
}

export interface EventsPageModel {
  rows: EventRow[]
  statusFilters: FilterChip[]
  serviceFilters: ServiceChip[]
  showAudit: AuditSwitch
  q: string | null
  clearSearchHref: string
  errorFilter: ErrorNote | null
  timeRange: TimeRange
  topFailures: TopFailures | null
  searchFilters: SearchFilter[]
  rangeFilters: SearchFilter[]
  fromInput: string
  toInput: string
  nextHref: string | null
  unavailableSources: string
  unavailable: boolean
  refused: boolean
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value

const toCurrentSearch = ({ cursor, ...query }: EventsPageQuery): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined) as [
      string,
      string
    ][]
  )

  return params.size ? `?${params}` : ''
}

const toEventPageHref = (event: EventKey, from: string): string => {
  const href = toEventHref(event)

  return from === '' ? href : `${href}?from=${encodeURIComponent(from)}`
}

const toRow =
  (now: Date, from: string, services: ServiceFilter[]) =>
  (event: EventRowResponse): EventRow => {
    const created = toTimestamp(event.createdAt, now)

    return {
      eventHref: toEventPageHref(event, from),
      eventId: event.eventId,
      status: event.status,
      statusLabel: event.statusLabel,
      statusRole: event.statusRole,
      statusRetrying: event.statusRetrying,
      latency: event.latency,
      latencyTitle: event.latencyTitle,
      createdAt: created.text,
      createdAtInstant: created.instant,
      createdAtPrecise: created.precise,
      createdAtClock: toClockOf(event.createdAt, now),
      eventName: toEventName(event.type),
      serviceLabel: toServiceLabel(event.service, services),
      boxLabel: toBoxLabel(event.box),
      isDeadLetter: isDeadLetterStatus(event.status)
    }
  }

const toClockOf = (value: string, now: Date): string => {
  const date = toValidDate(value)

  return date === null ? '' : toClock(date, now)
}

const counted = new Intl.NumberFormat('en-GB')

const toUnavailableSources = (sourceErrors: SourceError[] = []): string =>
  sourceErrors.map((source) => source.hop).join(', ')

const filterKeys = [
  'status',
  'service',
  'audit',
  'q',
  'error',
  'from',
  'to',
  'range'
] as const

type FilterKey = (typeof filterKeys)[number]

const filterKeysWithout = (...dropped: FilterKey[]): FilterKey[] =>
  filterKeys.filter((key) => !dropped.includes(key))

const toFields = (
  query: EventsPageQuery,
  keys: readonly FilterKey[]
): SearchFilter[] =>
  keys.flatMap((name) => {
    const value = query[name]

    return value ? [{ name, value }] : []
  })

const addFilters = (
  params: URLSearchParams,
  query: EventsPageQuery
): URLSearchParams => {
  for (const { name, value } of toFields(query, filterKeys)) {
    params.set(name, value)
  }

  return params
}

const toFilterHref = (query: EventsPageQuery): string => {
  const params = addFilters(new URLSearchParams(), query)

  return params.size ? `/dev-ops/events?${params}` : '/dev-ops/events'
}

const toCount = (count: number | null) => ({
  countLabel: count === null ? null : counted.format(count),
  zero: count === 0
})

const toSum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

const isAlarming = (status: string, count: number | null): boolean =>
  isDeadLetterStatus(status) && (count ?? 0) > 0

const countOf = (counts: EventCounts, status: string): number =>
  (counts as unknown as Record<string, number>)[status] ?? 0

/** A facet: `counts` takes no `status`, so no figure moves with the selection. */
const toStatusChips = (
  query: EventsPageQuery,
  facets: EventFacets | null,
  statuses: StatusFilter[]
): FilterChip[] => {
  const counts = facets?.counts ?? null

  return [
    {
      value: null,
      label: 'All',
      href: toFilterHref({ ...query, status: undefined }),
      active: !query.status,
      alarming: false,
      title: null,
      ...toCount(
        counts === null
          ? null
          : toSum(statuses.map(({ value }) => countOf(counts, value)))
      )
    },
    ...statuses.map(({ value, label, explainer }) => {
      const count = counts === null ? null : countOf(counts, value)

      return {
        value,
        label,
        href: toFilterHref({ ...query, status: value }),
        active: query.status === value,
        alarming: isAlarming(value, count),
        title: explainer,
        ...toCount(count)
      }
    })
  ]
}

const toServiceChips = (
  query: EventsPageQuery,
  services: ServiceFilter[]
): ServiceChip[] => [
  {
    value: null,
    label: 'All',
    href: toFilterHref({ ...query, service: undefined }),
    active: !query.service
  },
  ...services.map(({ value }) => ({
    value,
    label: toServiceLabel(value, services),
    href: toFilterHref({ ...query, service: value }),
    active: query.service === value
  }))
]

const toAuditSwitch = (query: EventsPageQuery): AuditSwitch => {
  const checked = query.audit === 'include'

  return {
    checked,
    href: toFilterHref({ ...query, audit: checked ? undefined : 'include' }),
    label: 'Show audit events',
    title: checked
      ? 'Hide audit events: the queue alone'
      : 'Show audit events alongside the queue'
  }
}

/** The search form carries every filter but the search itself. */
const toSearchFilters = (query: EventsPageQuery): SearchFilter[] =>
  toFields(query, filterKeysWithout('q'))

/** The range form carries every filter but the range it sets. */
const toRangeFilters = (query: EventsPageQuery): SearchFilter[] =>
  toFields(query, filterKeysWithout('from', 'to', 'range'))

const toNextHref = (
  { hasNextPage, endCursor }: EventsPagination,
  query: EventsPageQuery
): string | null => {
  if (!hasNextPage || !endCursor) {
    return null
  }

  const params = addFilters(new URLSearchParams({ cursor: endCursor }), query)

  return `/dev-ops/events?${params}`
}

const toSearch = (value: string | undefined): string | null => {
  const needle = value?.trim() ?? ''

  return needle === '' ? null : needle
}

/**
 * `datetime-local` carries no zone, so the digits in the Custom boxes have to
 * be the ones the page displays. Writing the UTC wall clock into a control the
 * browser reads as local was an hour out at both edges of a range under BST.
 */
const toRangeInput = (value: string | undefined): string => {
  if (!value) {
    return ''
  }

  const date = toValidDate(value)

  return date === null ? value : toZonedInput(date)
}

const displayedFilterErrorChars = 60

const toErrorNote = (query: EventsPageQuery): ErrorNote | null => {
  const message = query.error

  if (!message) {
    return null
  }

  return {
    label: truncate(message, displayedFilterErrorChars),
    title: message,
    clearHref: toFilterHref({ ...query, error: undefined })
  }
}

const timeRangePresets: { key: string; minutes: number }[] = [
  { key: '15m', minutes: 15 },
  { key: '1h', minutes: minutesPerHour },
  { key: '6h', minutes: 6 * minutesPerHour },
  { key: '24h', minutes: hoursPerDay * minutesPerHour },
  { key: '7d', minutes: 7 * hoursPerDay * minutesPerHour },
  { key: '30d', minutes: 30 * hoursPerDay * minutesPerHour }
]

const presetLabel = (key: string) => `Last ${key}`

const presetTitle = (key: string) => `Events from the last ${key}`

const toActivePreset = ({ from, to, range }: EventsPageQuery) =>
  from && !to
    ? timeRangePresets.find((preset) => preset.key === range)
    : undefined

const toPresets = (query: EventsPageQuery, now: Date): TimeRangePreset[] => {
  const active = toActivePreset(query)

  return timeRangePresets.map(({ key, minutes }) => ({
    key,
    label: presetLabel(key),
    title: presetTitle(key),
    active: active?.key === key,
    href: toFilterHref({
      ...query,
      from: new Date(now.getTime() - minutes * msPerMinute).toISOString(),
      to: undefined,
      range: key
    })
  }))
}

const toAbsoluteMinute = (value: string): string => {
  const date = toValidDate(value)

  return date === null
    ? value
    : toZonedInput(date).slice(0, 'yyyy-mm-ddThh:mm'.length).replace('T', ' ')
}

const toAbsoluteRangeLabel = (from?: string, to?: string): string => {
  const start = from ? toAbsoluteMinute(from) : 'earliest'
  const end = to ? toAbsoluteMinute(to) : 'now'

  return `${start} – ${end}`
}

const toTimeRangeLabel = (query: EventsPageQuery): string => {
  const { from, to } = query

  if (!from && !to) {
    return 'All'
  }

  const preset = toActivePreset(query)

  return preset ? presetLabel(preset.key) : toAbsoluteRangeLabel(from, to)
}

const toTimeRange = (query: EventsPageQuery, now: Date): TimeRange => {
  const label = toTimeRangeLabel(query)

  return {
    label,
    title: `Time range: ${label}`,
    active: Boolean(query.from ?? query.to),
    presets: toPresets(query, now),
    anyTimeHref: toFilterHref({
      ...query,
      from: undefined,
      to: undefined,
      range: undefined
    }),
    anyTimeActive: !query.from && !query.to
  }
}

const displayedGroupErrorChars = 90

const toGroupMessage = (message: string | null): string =>
  message === null ? none : truncate(message, displayedGroupErrorChars)

const toFailureGroup =
  (query: EventsPageQuery, now: Date) =>
  (group: EventBreakdownGroup): FailureGroup => {
    const first = toTimestamp(group.firstAt, now)
    const last = toTimestamp(group.lastAt, now)

    return {
      message: toGroupMessage(group.error),
      messageTitle: group.error,
      type: group.type,
      eventName: toEventName(group.type),
      countLabel: counted.format(group.count),
      firstAt: first.text,
      firstInstant: first.instant,
      firstPrecise: first.precise,
      lastAt: last.text,
      lastInstant: last.instant,
      lastPrecise: last.precise,
      // An error is not a status, and the tiles reflect `status` alone.
      href:
        group.error === null
          ? null
          : toFilterHref({ ...query, error: group.error })
    }
  }

const toFailuresSummary = (count: number): string =>
  `Top errors (${count} group${count === 1 ? '' : 's'})`

const toTopFailures = (
  breakdown: EventBreakdownPage | null,
  query: EventsPageQuery,
  now: Date
): TopFailures | null => {
  const groups = breakdown === null ? [] : breakdown.groups

  if (groups.length === 0 || !showsDeadLetterContent(query)) {
    return null
  }

  return {
    groups: groups.map(toFailureGroup(query, now)),
    summary: toFailuresSummary(groups.length)
  }
}

export const toEventsPage = (
  {
    page,
    statuses,
    services,
    facets,
    breakdown,
    unavailable,
    refused
  }: EventsResult,
  query: EventsPageQuery,
  now: Date = new Date()
): EventsPageModel => {
  const { events, pagination, sourceErrors } = page
  const currentSearch = toCurrentSearch(query)
  const q = toSearch(query.q)
  const filters: EventsPageQuery = { ...query, q: q ?? undefined }
  const rows = events.map(toRow(now, currentSearch, services))

  return {
    rows,
    statusFilters: toStatusChips(filters, facets, statuses),
    serviceFilters: toServiceChips(filters, services),
    showAudit: toAuditSwitch(filters),
    q,
    clearSearchHref: toFilterHref({ ...filters, q: undefined }),
    errorFilter: toErrorNote(filters),
    timeRange: toTimeRange(filters, now),
    topFailures: toTopFailures(breakdown, filters, now),
    searchFilters: toSearchFilters(filters),
    rangeFilters: toRangeFilters(filters),
    fromInput: toRangeInput(query.from),
    toInput: toRangeInput(query.to),
    nextHref: toNextHref(pagination, filters),
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable,
    refused: refused ?? false
  }
}
