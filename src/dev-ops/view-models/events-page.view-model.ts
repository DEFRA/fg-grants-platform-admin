import { showsDeadLetterContent } from '../use-cases/dead-letter-page.ts'
import {
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  none,
  toClock,
  toEventHref,
  toTimestamp
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

/**
 * `range` is only a label naming the preset that produced the window (`24h`).
 * It never reaches fg-gas-backend and selects no rows — the window itself
 * travels as the absolute `from` the preset link wrote. See `toActivePreset`.
 */
export interface EventsPageQuery extends EventsQuery {
  range?: string
}

interface EventRow extends Omit<EventRowResponse, 'createdAt'> {
  /**
   * This row's own page, with the list's query folded into `?from=` so the
   * back link there returns to the page the operator left — same filter, same
   * search, same cursor.
   */
  eventHref: string
  /** Relative, computed at render time: `22m ago`, `3h 12m ago`, `2d ago`. */
  createdAt: string
  /** `2026-06-16T10:00:00Z` — the one quotable spelling, same as the detail page. */
  createdAtTitle: string
  /**
   * The wall clock under the relative age, UTC. A row under a day old draws
   * the time alone (`08:18:01`); an older one takes the date and drops the
   * seconds (`1 Sep 08:18`) — a bare clock lies on old rows, and the page
   * filtered to Dead letter is exactly the page whose rows are old.
   */
  createdAtClock: string
  /** The only status the template tints. */
  isDeadLetter: boolean
}

/** The `?error=` failure the page is narrowed to, said back in the strip. */
interface ErrorNote {
  /** Truncated to the strip's one line. */
  label: string
  /** The whole message. */
  title: string
  /** The same page with the failure filter taken off it. */
  clearHref: string
}

/**
 * One rung of the preset ladder, as a link. Each sets `from` and clears `to`:
 * a window that ends is one the operator chose deliberately, and `last hour`
 * means up to now by definition.
 */
interface TimeRangePreset {
  /** `24h` — the key that travels as `?range=`. */
  key: string
  /** `Last 24h`, as the button and the list both say it. */
  label: string
  href: string
  title: string
  active: boolean
}

/** The time-range control: a button stating the active window, and the panel. */
interface TimeRange {
  /** What the button says: `Any time`, `Last 24h`, or the absolute pair. */
  label: string
  title: string
  /** Whether any window is set at all, so the button can read as a filter. */
  active: boolean
  presets: TimeRangePreset[]
  /** The rung that clears the window, drawn with the others. */
  anyTimeHref: string
  anyTimeActive: boolean
}

/** One failure, and every dead letter it caused. */
interface FailureGroup {
  /** Truncated to one line of the panel. */
  message: string
  /**
   * The whole message — the string an operator greps a log for. Null on a
   * group that recorded none: there is no fuller spelling of a dash.
   */
  messageTitle: string | null
  /** `audit` for the records that are not CloudEvents. */
  type: string
  /** Locale-grouped: `4,182`. */
  countLabel: string
  firstAt: string
  firstTitle: string
  lastAt: string
  lastTitle: string
  /**
   * The same page narrowed to this one failure. Null on a group that recorded
   * no message: `?error=` matches a message, so the only link that cell could
   * carry is one to a WIDER page than the row it sits on describes — a click
   * nobody asked for. The dash does not participate.
   */
  href: string | null
}

/** The panel above the table: which failures the dead letters actually are. */
interface TopFailures {
  groups: FailureGroup[]
  count: number
  /** `Top errors (3 groups)` — the whole of the folded state. */
  summary: string
  open: boolean
}

/** One segment of one filter control: a word, and its count. */
export interface FilterChip {
  /** The wire value this segment selects; null on `All`, which selects none. */
  value: string | null
  label: string
  href: string
  active: boolean
  /**
   * Locale-grouped: `7,064`. Null when the counts could not be read, and the
   * control then draws the labels it always had: a summary that failed has not
   * made the filter beneath it an error.
   */
  countLabel: string | null
  /**
   * Nothing behind this segment. Dimmed, and still a link: a segment that
   * vanished when it emptied could not be told from one the page forgot to
   * draw.
   */
  zero: boolean
  /** Dead letters only, and only while there are some — a zero is no alarm. */
  alarming: boolean
  /**
   * What the state means, on the segment's own title. Null on service
   * segments, and on a status this app has never seen.
   */
  title: string | null
}

/** One filter re-stated as a hidden field on the search form. */
interface SearchFilter {
  name: string
  value: string
}

export interface EventsPageModel {
  /** Every row on the page, in the endpoint's order. One row per event. */
  rows: EventRow[]
  /** All · Published · … · Dead letter, in the order a message travels. */
  statusFilters: FilterChip[]
  /** All · GAS · Caseworking. */
  serviceFilters: FilterChip[]
  /** Hide · Show. See toAuditChips. */
  auditFilters: FilterChip[]
  /**
   * `243,297 events` — how many events every filter on the page selects,
   * stated once over the table. Null when the counts could not be read.
   */
  eventsTotal: string | null
  /** What the page is searched for, trimmed, or null when it is not. */
  q: string | null
  /** The same page with the search taken off it, for the `Clear` links. */
  clearSearchHref: string
  /** The failure the page is narrowed to, or null when it is not. */
  errorFilter: ErrorNote | null
  timeRange: TimeRange
  /**
   * Which failures the dead letters are. Null when there are none to report,
   * when the read failed, and on every page that is not about dead letters.
   */
  topFailures: TopFailures | null
  /** Hidden fields for the search form. See toSearchFilters. */
  searchFilters: SearchFilter[]
  /** Hidden fields for the absolute-range form. See toRangeFilters. */
  rangeFilters: SearchFilter[]
  /** The From box's value, in the spelling `datetime-local` reads and writes. */
  fromInput: string
  /** The To box's, the same way. Both empty on a page with no range on it. */
  toInput: string
  previousHref: string | null
  nextHref: string | null
  /** `CW Inbox, CW Outbox` — empty when every source answered. */
  unavailableSources: string
  /** Nothing could be read at all. */
  unavailable: boolean
  /**
   * The endpoint refused this link's parameters rather than failing. Drawn as
   * a warning about the link, not as the outage card — the page an operator
   * opens to check whether the estate is up must not tell them it is down
   * because they hand-edited a cursor.
   */
  refused: boolean
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value

/**
 * The list's own url, for the inspect page to hand back. Every parameter is
 * carried, cursor included: unlike a filter link, the operator is going one
 * row deep and coming straight back, and must not lose their place.
 */
const toCurrentSearch = (query: EventsPageQuery): string => {
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
  (now: Date, from: string) =>
  (event: EventRowResponse): EventRow => {
    const created = toTimestamp(event.createdAt, now)

    return {
      ...event,
      eventHref: toEventPageHref(event, from),
      createdAt: created.text,
      createdAtTitle: created.title,
      createdAtClock: toClockOf(event.createdAt, now),
      isDeadLetter: event.status === 'DEAD_LETTER'
    }
  }

const toClockOf = (value: string, now: Date): string => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '' : toClock(date, now)
}

const counted = new Intl.NumberFormat('en-GB')

const toUnavailableSources = (sourceErrors: SourceError[] = []): string =>
  sourceErrors.map((source) => source.hop).join(', ')

/**
 * The filters, added to whatever the link already carries. The search is one
 * of them: narrowing by status while holding a reference must not silently
 * drop the reference.
 */
const addFilters = (
  params: URLSearchParams,
  { status, service, audit, q, error, from, to, range }: EventsPageQuery
): URLSearchParams => {
  const fields: [string, string | undefined][] = [
    ['status', status],
    ['service', service],
    ['audit', audit],
    ['q', q],
    ['error', error],
    ['from', from],
    ['to', to],
    ['range', range]
  ]

  for (const [name, value] of fields) {
    if (value) {
      params.set(name, value)
    }
  }

  return params
}

/**
 * A filter link carries the *other* filters and nothing else. `cursor` and
 * `direction` are deliberately dropped: a keyset position taken in one filter
 * means nothing in another, so changing a filter starts the list again.
 */
const toFilterHref = (query: EventsPageQuery): string => {
  const params = addFilters(new URLSearchParams(), query)

  return params.size ? `/dev-ops/events?${params}` : '/dev-ops/events'
}

/**
 * A null count draws the label the control always had: a count that could not
 * be read is not an error worth an alert on this page.
 */
const toSegmentCount = (count: number | null) => ({
  countLabel: count === null ? null : counted.format(count),
  zero: count === 0
})

const toSum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

/** A red zero is an alarm about nothing. */
const isAlarming = (status: string, count: number | null): boolean =>
  status === 'DEAD_LETTER' && (count ?? 0) > 0

/**
 * How many events the page is actually showing, across every filter on it —
 * the status included. `counts` is a facet and deliberately does NOT move
 * with the selected status, so the total is the whole block summed when no
 * status is chosen, and that status's own figure when one is.
 */
const toTotalOf = (
  counts: EventCounts,
  statuses: StatusFilter[],
  status?: string
): number => {
  const known = statuses.map(({ value }) => countOf(counts, value))

  if (!status) {
    return toSum(known)
  }

  // A `?status=` this page has no segment for counts as none of them, which is
  // the same answer the toolbar gives it: no segment lights up either.
  return statuses.some((filter) => filter.value === status)
    ? countOf(counts, status)
    : 0
}

/**
 * A status the counts block has no key for counts as zero: the endpoint
 * reports every status it knows, so a gap means none of them.
 */
const countOf = (counts: EventCounts, status: string): number =>
  (counts as unknown as Record<string, number>)[status] ?? 0

const toEventsTotal = (
  query: EventsPageQuery,
  facets: EventFacets | null,
  statuses: StatusFilter[]
): string | null => {
  if (!facets) {
    return null
  }

  const total = toTotalOf(facets.counts, statuses, query.status)

  return `${counted.format(total)} ${total === 1 ? 'event' : 'events'}`
}

/**
 * The counts endpoint does not take `status`: that refusal is exactly what
 * makes `counts` the status facet — every segment reports what selecting it
 * would find, whatever is selected now.
 *
 * `All` deliberately carries no figure: as a facet it would not move when a
 * status is selected, so it looked like the page total while being the one
 * figure the status filter did not change. The total is stated once, over the
 * table.
 */
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
      ...toSegmentCount(null)
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
        ...toSegmentCount(count)
      }
    })
  ]
}

/**
 * The service segments deliberately carry no counts — the status row is where
 * the arithmetic belongs. `toSegmentCount(null)` rather than an omitted key,
 * so every chip on the page has the same shape.
 */
const toServiceChips = (
  query: EventsPageQuery,
  services: ServiceFilter[]
): FilterChip[] => [
  {
    value: null,
    label: 'All',
    href: toFilterHref({ ...query, service: undefined }),
    active: !query.service,
    alarming: false,
    title: null,
    ...toSegmentCount(null)
  },
  ...services.map(({ value, label }) => ({
    value,
    label,
    href: toFilterHref({ ...query, service: value }),
    active: query.service === value,
    alarming: false,
    title: null,
    ...toSegmentCount(null)
  }))
]

/**
 * Whether the audit records are in the population. Excluded by default: an
 * audit trail records what people did, a queue what messages did, and mixed
 * together the audit records outnumber everything else and bury the queue's
 * own shape.
 *
 * Hide is the default and therefore the parameterless url — it takes `audit`
 * off the link rather than spelling the default out, so one page has one url.
 * An explicit `?audit=exclude` still lights it. The segments say Hide and
 * Show, which read on from the "Audit records" label; the wire keeps
 * `exclude`/`include`. Like the service segments, these carry no counts.
 */
const toAuditChips = (query: EventsPageQuery): FilterChip[] => {
  const included = query.audit === 'include'

  return [
    {
      value: 'exclude',
      label: 'Hide',
      href: toFilterHref({ ...query, audit: undefined }),
      active: !included,
      alarming: false,
      title: 'Hide audit records: the queue alone',
      ...toSegmentCount(null)
    },
    {
      value: 'include',
      label: 'Show',
      href: toFilterHref({ ...query, audit: 'include' }),
      active: included,
      alarming: false,
      title: 'Show audit records alongside the queue',
      ...toSegmentCount(null)
    }
  ]
}

const toFields = (fields: [string, string | undefined][]): SearchFilter[] =>
  fields.flatMap(([name, value]) => (value ? [{ name, value }] : []))

/**
 * The filters the SEARCH form re-states as hidden fields: a GET form submits
 * its own controls and nothing else, so without them searching from a page
 * filtered to Dead letter would quietly widen it to every status. `cursor`
 * and `direction` are not among them, exactly as on a filter link. `range`
 * travels too, or a search from `Last 24h` would come back saying an absolute
 * pair.
 */
const toSearchFilters = ({
  status,
  service,
  audit,
  error,
  from,
  to,
  range
}: EventsPageQuery): SearchFilter[] =>
  toFields([
    ['status', status],
    ['service', service],
    ['audit', audit],
    ['error', error],
    ['from', from],
    ['to', to],
    ['range', range]
  ])

/**
 * The filters the ABSOLUTE-RANGE form re-states: it carries the search, and
 * deliberately neither `from`/`to` — its own two boxes are those — nor
 * `range`, because applying a window of your own is precisely what stops it
 * being `Last 24h`.
 */
const toRangeFilters = ({
  status,
  service,
  audit,
  error,
  q
}: EventsPageQuery): SearchFilter[] =>
  toFields([
    ['status', status],
    ['service', service],
    ['audit', audit],
    ['error', error],
    ['q', q]
  ])

/**
 * The cursor is only a keyset position, so the filters have to be carried on
 * the link or the next page quietly widens to All.
 */
const toHref = (
  cursor: string | null,
  direction: 'forward' | 'backward',
  query: EventsPageQuery
): string | null => {
  if (!cursor) {
    return null
  }

  const params = addFilters(new URLSearchParams({ cursor, direction }), query)

  return `/dev-ops/events?${params}`
}

const toPagerHrefs = (
  pagination: EventsPagination,
  query: EventsPageQuery
) => ({
  previousHref: pagination.hasPreviousPage
    ? toHref(pagination.startCursor, 'backward', query)
    : null,
  nextHref: pagination.hasNextPage
    ? toHref(pagination.endCursor, 'forward', query)
    : null
})

/**
 * Trimmed, and absent rather than empty: a box submitted with nothing but
 * spaces in it is not a search.
 */
const toSearch = (value: string | undefined): string | null => {
  const needle = value?.trim() ?? ''

  return needle === '' ? null : needle
}

/**
 * The box reads and writes `2026-06-16T09:00:00`, the endpoint
 * `2026-06-16T09:00:00.000Z`, and this is the only place that knows it. A
 * value that does not parse is handed back untouched rather than blanked —
 * the operator can see what they sent, and the error alert beside it says
 * what GAS made of it.
 */
const toLocalInput = (value: string | undefined): string => {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().slice(0, 'yyyy-mm-ddThh:mm:ss'.length)
}

/** The strip has one line, and a stack trace summary does not fit on it. */
const displayedFilterErrorChars = 60

/**
 * Said in the strip because `?error=` arrives by being clicked — nothing on
 * the toolbar shows it, and a filter an operator cannot see is one they will
 * not think to remove.
 */
const toErrorNote = (query: EventsPageQuery): ErrorNote | null => {
  const message = query.error

  if (!message) {
    return null
  }

  return {
    label: truncate(message, displayedFilterErrorChars),
    title: message,
    clearHref: toFilterHref({ ...query, error: undefined, cursor: undefined })
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

/**
 * Which rung the page is standing on, if any.
 *
 * A preset link writes an ABSOLUTE `from` — a relative window and a keyset
 * cursor cannot both be true a minute later — which makes the window
 * unambiguous and the label unrecoverable: no arithmetic here can tell `Last
 * 24h` from an absolute range that happens to look like one. So the link
 * carries its own name as `?range=`, trusted only where it is consistent with
 * the window it claims — a `from` and no `to`, the shape every preset link
 * produces — so a hand-edited url says the honest absolute thing rather than
 * the flattering one.
 */
const toActivePreset = ({ from, to, range }: EventsPageQuery) =>
  from && !to
    ? timeRangePresets.find((preset) => preset.key === range)
    : undefined

/**
 * Each rung sets `from` and clears `to`, keeping every other filter. The
 * instant is computed at render, because it is a url the browser resolves
 * against nothing.
 */
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
      range: key,
      cursor: undefined
    })
  }))
}

/** `2026-09-01 00:00`, from the ISO instant both ends actually travel in. */
const toAbsoluteMinute = (value: string): string => {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().slice(0, 'yyyy-mm-ddThh:mm'.length).replace('T', ' ')
}

/**
 * No zone on it: every instant this page draws is UTC. An open end is named
 * rather than blanked — `earliest` and `now` are what the endpoint actually
 * does with a missing bound.
 */
const toAbsoluteRangeLabel = (from?: string, to?: string): string => {
  const start = from ? toAbsoluteMinute(from) : 'earliest'
  const end = to ? toAbsoluteMinute(to) : 'now'

  return `${start} → ${end}`
}

const toTimeRangeLabel = (query: EventsPageQuery): string => {
  const { from, to } = query

  if (!from && !to) {
    return 'Any time'
  }

  const preset = toActivePreset(query)

  return preset ? presetLabel(preset.key) : toAbsoluteRangeLabel(from, to)
}

/**
 * `Any time` is deliberately a rung like the others rather than a `Clear ×`
 * off to one side: "no window" is a choice about the range, made where the
 * range is changed.
 */
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
      range: undefined,
      cursor: undefined
    }),
    anyTimeActive: !query.from && !query.to
  }
}

/**
 * Ninety characters is enough to tell `E11000 duplicate key error collection:
 * gas.events index: eventId_1` from the same error on another index, which is
 * the distinction the panel exists to draw.
 */
const displayedGroupErrorChars = 90

const toGroupMessage = (message: string | null): string =>
  message === null ? none : truncate(message, displayedGroupErrorChars)

/**
 * The link applies `?status=DEAD_LETTER&error=<the whole message>` — verbatim,
 * because the endpoint matches it exactly and a truncated needle would answer
 * a question nobody asked — and keeps every filter the panel was computed
 * under. A group that recorded no message gets no link: `?error=` has nothing
 * to match on, so the only page it could open is a wider one than the row
 * claims to be about.
 */
const toFailureGroup =
  (query: EventsPageQuery, now: Date) =>
  (group: EventBreakdownGroup): FailureGroup => {
    const first = toTimestamp(group.firstAt, now)
    const last = toTimestamp(group.lastAt, now)

    return {
      message: toGroupMessage(group.error),
      messageTitle: group.error,
      type: group.type,
      countLabel: counted.format(group.count),
      firstAt: first.text,
      firstTitle: first.title,
      lastAt: last.text,
      lastTitle: last.title,
      href:
        group.error === null
          ? null
          : toFilterHref({
              ...query,
              status: 'DEAD_LETTER',
              error: group.error,
              cursor: undefined
            })
    }
  }

const toFailuresSummary = (count: number): string =>
  `Top errors (${count} group${count === 1 ? '' : 's'})`

/**
 * Open on a page already about dead letters. Folded on an unfiltered page
 * with dead letters behind it — worth announcing, not worth pushing the table
 * down for. Absent on every other page.
 */
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
    count: groups.length,
    summary: toFailuresSummary(groups.length),
    open: query.status === 'DEAD_LETTER'
  }
}

/**
 * @param now Injected so the relative times a test asserts on are the times it
 *   set up; the page itself renders against the clock at request time.
 */
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
  // Every link on the page is built from the trimmed search, so a stray space
  // cannot make two spellings of one query paginate differently.
  const filters: EventsPageQuery = { ...query, q: q ?? undefined }
  const rows = events.map(toRow(now, currentSearch))

  return {
    rows,
    eventsTotal: toEventsTotal(filters, facets, statuses),
    statusFilters: toStatusChips(filters, facets, statuses),
    serviceFilters: toServiceChips(filters, services),
    auditFilters: toAuditChips(filters),
    q,
    clearSearchHref: toFilterHref({ ...filters, q: undefined }),
    errorFilter: toErrorNote(filters),
    timeRange: toTimeRange(filters, now),
    topFailures: toTopFailures(breakdown, filters, now),
    searchFilters: toSearchFilters(filters),
    rangeFilters: toRangeFilters(filters),
    fromInput: toLocalInput(query.from),
    toInput: toLocalInput(query.to),
    ...toPagerHrefs(pagination, filters),
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable,
    refused: refused ?? false
  }
}
