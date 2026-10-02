import { showsDeadLetterContent } from '../use-cases/dead-letter-page.ts'
import { toBoxLabel, toServiceLabel } from './event-labels.ts'
import { toEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { isDeadLetterStatus } from './event-state.ts'
import {
  none,
  toClock,
  toEventHref,
  toTimestamp,
  toValidDate
} from './event-formats.ts'
import { toTimeRange } from './time-range.view-model.ts'
import type { TimeRange, TimeRangeList } from './time-range.view-model.ts'
import { toFields, toFilterHref } from './list-filters.ts'
import type { FilterField } from './list-filters.ts'
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

export interface EventRow {
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
  searchFilters: FilterField[]
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

/** One events-list row; `from` is the list query the event page's Back returns to. */
export const toEventRow =
  (now: Date, from: string, services?: ServiceFilter[]) =>
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

const eventsPath = '/dev-ops/events'

const toEventsHref = (query: EventsPageQuery): string =>
  toFilterHref(eventsPath, filterKeys, query)

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
      href: toEventsHref({ ...query, status: undefined }),
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
        href: toEventsHref({ ...query, status: value }),
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
    href: toEventsHref({ ...query, service: undefined }),
    active: !query.service
  },
  ...services.map(({ value }) => ({
    value,
    label: toServiceLabel(value, services),
    href: toEventsHref({ ...query, service: value }),
    active: query.service === value
  }))
]

const toAuditSwitch = (query: EventsPageQuery): AuditSwitch => {
  const checked = query.audit === 'include'

  return {
    checked,
    href: toEventsHref({ ...query, audit: checked ? undefined : 'include' }),
    label: 'Show audit events',
    title: checked
      ? 'Hide audit events: the queue alone'
      : 'Show audit events alongside the queue'
  }
}

/** The search form carries every filter but the search itself. */
const toSearchFilters = (query: EventsPageQuery): FilterField[] =>
  toFields(query, filterKeysWithout('q'))

const eventsList: TimeRangeList<EventsPageQuery> = {
  basePath: eventsPath,
  filterKeys,
  presetTitle: 'Events from the last'
}

const toNextHref = (
  { hasNextPage, endCursor }: EventsPagination,
  query: EventsPageQuery
): string | null => {
  if (!hasNextPage || !endCursor) {
    return null
  }

  return toFilterHref(
    eventsPath,
    filterKeys,
    query,
    new URLSearchParams({ cursor: endCursor })
  )
}

const toSearch = (value: string | undefined): string | null => {
  const needle = value?.trim() ?? ''

  return needle === '' ? null : needle
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
    clearHref: toEventsHref({ ...query, error: undefined })
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
          : toEventsHref({ ...query, error: group.error })
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
  const rows = events.map(toEventRow(now, currentSearch, services))

  return {
    rows,
    statusFilters: toStatusChips(filters, facets, statuses),
    serviceFilters: toServiceChips(filters, services),
    showAudit: toAuditSwitch(filters),
    q,
    clearSearchHref: toEventsHref({ ...filters, q: undefined }),
    errorFilter: toErrorNote(filters),
    timeRange: toTimeRange(eventsList, filters, now),
    topFailures: toTopFailures(breakdown, filters, now),
    searchFilters: toSearchFilters(filters),
    nextHref: toNextHref(pagination, filters),
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable,
    refused: refused ?? false
  }
}
