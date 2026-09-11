import { showsDeadLetterContent } from '../use-cases/dead-letter-page.ts'
import { toEventName } from './event-names.ts'
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

/**
 * The list's row. It draws the service and the box as columns of their own,
 * so the hop that joins them (`GAS Inbox`) and the line the detail page draws
 * under it — `queue`, and the topic on its title — are not carried.
 */
interface EventRow extends Omit<
  EventRowResponse,
  'createdAt' | 'hop' | 'queue' | 'queueValue'
> {
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
  /**
   * What the event is — `CreateAgreement` — under the id, with the raw
   * `type` on its title. See toEventName.
   */
  typeName: string
  /** The same name spaced, `Create agreement`, for a screen reader. */
  typeNameSpoken: string
  /** `GAS`, `CW-BE` — the Service filter's own word for it. See toServiceLabel. */
  serviceLabel: string
  /** `Inbox` or `Outbox`. See boxLabels. */
  boxLabel: string
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
  /**
   * The value the trigger says after `Time:` — `Any`, `Last 24h`, or the
   * absolute pair. The panel's own rung keeps the fuller `Any time`.
   */
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
  /**
   * The raw type the rows in this group share — `audit` for the records that
   * are not CloudEvents — on the name's title.
   */
  type: string
  /** `AuditRecord`, as the rows say it. See toEventName. */
  typeName: string
  /** The same name spaced, for a screen reader. */
  typeNameSpoken: string
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
}

/**
 * One option of one filter: a status tile, or an item in the Service menu. A
 * word, and — on the statuses — its count.
 */
export interface FilterChip {
  /** The wire value this option selects; null on `All`, which selects none. */
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
   * Nothing behind this option. A quiet 0, and still a link: a tile that
   * vanished when it emptied could not be told from one the page forgot to
   * draw.
   */
  zero: boolean
  /** Dead letters only, and only while there are some — a zero is no alarm. */
  alarming: boolean
  /**
   * What the state means, on the option's own title. Null on the services,
   * on `All`, and on a status this app has never seen.
   */
  title: string | null
}

/**
 * "Show audit events": one link to the other state's url, drawn as a switch.
 * See toAuditSwitch.
 */
interface AuditSwitch {
  /** Whether the audit records are in the page — the switch is on. */
  checked: boolean
  /** The OTHER state's url: following the link is flipping the switch. */
  href: string
  label: string
  title: string
}

/** One filter re-stated as a hidden field on the search form. */
interface SearchFilter {
  name: string
  value: string
}

export interface EventsPageModel {
  /** Every row on the page, in the endpoint's order. One row per event. */
  rows: EventRow[]
  /**
   * All · Published · … · Dead letter, in the order a message travels: the
   * status tiles, figures and all.
   */
  statusFilters: FilterChip[]
  /** All · GAS · Caseworking. */
  serviceFilters: FilterChip[]
  /** "Show audit events". See toAuditSwitch. */
  showAudit: AuditSwitch
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
  /**
   * The next keyset page, carrying every filter: what the list loads as the
   * reader nears the bottom, and the no-script More link. Null on the last
   * page. There is no link back: the list only ever grows downwards.
   */
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
 * The list's own url, for the inspect page to hand back: every filter, and
 * no cursor. The list loads its later pages as the reader scrolls and has no
 * way back up from a cursor, so a row reached far down returns the operator
 * to the top of the same filtered list — Back to page one, the accepted
 * limit of loading on scroll — rather than stranding them mid-list.
 */
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

/**
 * The words this page uses for a service where they differ from the
 * endpoint's. The wire value is unchanged; only the word on the page moves,
 * and it moves here alone, so the Service trigger, its menu and the Service
 * column all say it the same way. The page's subtitle, the detail page and
 * the failures panel keep the endpoint's own words.
 */
const serviceLabelOverrides = new Map([['caseworking', 'CW-BE']])

/**
 * A service's label as this page says it: the override, else the endpoint's
 * label, else — for a service the endpoint never offered — the value as it
 * was sent, rather than a blank.
 */
const toServiceLabel =
  (services: ServiceFilter[]) =>
  (service: string): string =>
    serviceLabelOverrides.get(service) ??
    services.find(({ value }) => value === service)?.label ??
    service

/** The two boxes an event lives in. Anything else shows as it was sent. */
const boxLabels = new Map([
  ['inbox', 'Inbox'],
  ['outbox', 'Outbox']
])

const toRow =
  (now: Date, from: string, serviceLabel: (service: string) => string) =>
  ({ hop, queue, queueValue, ...event }: EventRowResponse): EventRow => {
    const created = toTimestamp(event.createdAt, now)
    const { name, spoken } = toEventName(event.type)

    return {
      ...event,
      eventHref: toEventPageHref(event, from),
      createdAt: created.text,
      createdAtTitle: created.title,
      createdAtClock: toClockOf(event.createdAt, now),
      typeName: name,
      typeNameSpoken: spoken,
      serviceLabel: serviceLabel(event.service),
      boxLabel: boxLabels.get(event.box) ?? event.box,
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
 * A filter link carries the *other* filters and nothing else. `cursor` is
 * deliberately dropped: a keyset position taken in one filter
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
const toCount = (count: number | null) => ({
  countLabel: count === null ? null : counted.format(count),
  zero: count === 0
})

const toSum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

/** A red zero is an alarm about nothing. */
const isAlarming = (status: string, count: number | null): boolean =>
  status === 'DEAD_LETTER' && (count ?? 0) > 0

/**
 * A status the counts block has no key for counts as zero: the endpoint
 * reports every status it knows, so a gap means none of them.
 */
const countOf = (counts: EventCounts, status: string): number =>
  (counts as unknown as Record<string, number>)[status] ?? 0

/**
 * The counts endpoint does not take `status`: that refusal is exactly what
 * makes `counts` the status facet — every tile reports what selecting it
 * would find, whatever is selected now.
 *
 * `All` is a facet like the rest: every status summed, which is what
 * selecting All finds. It does not move when a status is selected, and
 * neither does any other tile — the strip is a map of the population, and the
 * selected tile says which part of it the table is showing.
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

/**
 * The services deliberately carry no counts — the status tiles are where the
 * arithmetic belongs. `toCount(null)` rather than an omitted key, so
 * every option on the page has the same shape.
 */
const toServiceChips = (
  query: EventsPageQuery,
  services: ServiceFilter[]
): FilterChip[] => {
  const labelOf = toServiceLabel(services)

  return [
    {
      value: null,
      label: 'All',
      href: toFilterHref({ ...query, service: undefined }),
      active: !query.service,
      alarming: false,
      title: null,
      ...toCount(null)
    },
    ...services.map(({ value }) => ({
      value,
      label: labelOf(value),
      href: toFilterHref({ ...query, service: value }),
      active: query.service === value,
      alarming: false,
      title: null,
      ...toCount(null)
    }))
  ]
}

/**
 * Whether the audit records are in the population. Left out by default: an
 * audit trail records what people did, a queue what messages did, and mixed
 * together the audit records outnumber everything else and bury the queue's
 * own shape.
 *
 * Off is the default and therefore the parameterless url — switching off
 * takes `audit` off the link rather than spelling the default out, so one page
 * has one url, and an explicit `?audit=exclude` reads as off. On is
 * `?audit=include`. The link always goes to the state the switch is NOT in,
 * carrying every other filter and dropping the cursor, like any filter link.
 */
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

const toFields = (fields: [string, string | undefined][]): SearchFilter[] =>
  fields.flatMap(([name, value]) => (value ? [{ name, value }] : []))

/**
 * The filters the SEARCH form re-states as hidden fields: a GET form submits
 * its own controls and nothing else, so without them searching from a page
 * filtered to Dead letter would quietly widen it to every status. `cursor` is
 * not among them, exactly as on a filter link. `range`
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
 * the link or the next page quietly widens to All. No `direction`: the list
 * only pages forward, which is fg-gas-backend's default.
 */
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
    return 'Any'
  }

  const preset = toActivePreset(query)

  return preset ? presetLabel(preset.key) : toAbsoluteRangeLabel(from, to)
}

/**
 * `Any time` is deliberately a rung like the others rather than a `Clear ×`
 * off to one side: "no window" is a choice about the range, made where the
 * range is changed. The trigger says it shorter, as `Time: Any`.
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
    const { name, spoken } = toEventName(group.type)

    return {
      message: toGroupMessage(group.error),
      messageTitle: group.error,
      type: group.type,
      typeName: name,
      typeNameSpoken: spoken,
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
 * Drawn on a page already about dead letters and on an unfiltered page with
 * dead letters behind it; absent on every other page. Always folded: the
 * summary announces it, and the operator opens it — the table is what the
 * page is for.
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
    summary: toFailuresSummary(groups.length)
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
  const rows = events.map(toRow(now, currentSearch, toServiceLabel(services)))

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
    fromInput: toLocalInput(query.from),
    toInput: toLocalInput(query.to),
    nextHref: toNextHref(pagination, filters),
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable,
    refused: refused ?? false
  }
}
