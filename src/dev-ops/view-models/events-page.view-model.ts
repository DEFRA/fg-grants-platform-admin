import type { BadgeRole } from './event-formats.ts'
import {
  isAtMaxAttempts,
  noTimestamp,
  toAttempts,
  toClock,
  toAbsolute,
  toEventHref,
  toLatency,
  toQueue,
  toSourceName,
  toStatusBadge,
  toStatusExplainer,
  toStatusLabel,
  toTimestamp
} from './event-formats.ts'
import type {
  Event,
  EventBreakdownGroup,
  EventBreakdownPage,
  EventCounts,
  EventFacets,
  EventService,
  EventLastError,
  EventsPagination,
  EventsQuery,
  EventsResult,
  SourceError
} from '../use-cases/get-events.use-case.ts'

/**
 * The page's own query: every filter the endpoint takes, plus `range`.
 *
 * `range` is a LABEL and nothing else — `24h`, the name of the rung the
 * operator clicked. It never reaches fg-gas-backend, which would refuse it as
 * an unknown parameter, and it selects no rows: the window itself travels as
 * the absolute `from` the preset link wrote. It exists because a relative
 * window and a keyset cursor cannot both be true a minute later, so the range
 * has to be absolute — and an absolute range cannot say which preset produced
 * it. See `toActivePreset`.
 */
export interface EventsPageQuery extends EventsQuery {
  range?: string
}

export interface EventRow {
  /**
   * The whole id, drawn in full: a CloudEvent id is a ~36-character uuid and
   * a Mongo fallback id 24 hex characters, and either fits the Event track.
   * There is no sentence on it any more: an id is unique to one row, so there
   * was never a set of siblings for `?q=<id>` to find, and a link that
   * promised one was lying.
   */
  eventId: string
  /**
   * This one row's own page, with the list's query folded into `?from=` so the
   * back link there returns to the page the operator left — same filter, same
   * search, same cursor. The type carries it: it is the row's first word and
   * the one an operator points at when they want the whole of this event,
   * while the id and the reference keep pointing at `?q=` themselves, which is
   * a different question ("where else did this go?") with a different answer.
   */
  eventHref: string
  /**
   * The type, exactly as the endpoint spells it, drawn UNDER the id as the
   * secondary half of the row's identity. Null on a row that stores no type at
   * all — an audit record is not a CloudEvent and genuinely has none — and the
   * line is then simply not drawn. Nothing stands in for it: the id above is
   * the identity, and it is always there.
   */
  type: string | null
  /** `GAS · Outbox` — which hop of the journey this row is. */
  hop: string
  /**
   * The same page filtered to this hop's service, keeping every other filter
   * and dropping the cursor, exactly as a chip in the toolbar does. Null for a
   * service the filter bar has no chip for: a `?service=` the endpoint has
   * never heard of is a link that can only answer with an empty page.
   *
   * TODO: the hop is a service *and* a box, and only the service half is
   * filterable — the endpoint has no `?box=` parameter yet. When it grows one,
   * this link should narrow to the hop rather than to half of it.
   */
  hopHref: string | null
  /** `Filter to Caseworking` — what clicking the hop does. Null with the href. */
  hopTitle: string | null
  /**
   * The queue under it: the whole topic on an outbox row, `from GAS` on an
   * inbox one. Never cut to a character count — the column truncates it with
   * an ellipsis when it is narrow, and the whole of it is on the `title`.
   */
  queue: string | null
  /** The raw target, for the `title` and the clipboard. Null on an inbox row. */
  queueValue: string | null
  /** Relative, computed at render time: `22m ago`, `3h 12m ago`, `2d ago`. */
  createdAt: string
  /** `2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)` */
  createdAtTitle: string
  /**
   * The wall clock under the relative age: `10:00:00`, UTC. `22m ago` is the
   * right first reading and the wrong thing to match against a log line, and
   * the absolute was on a tooltip nobody hovers while scanning. The date is
   * not repeated on every row while the rows are from today — the page is one
   * keyset window and almost always one day — so a row under a day old draws
   * the time alone, `08:18:01`, and an older one takes the date and drops the
   * seconds: `1 Sep 08:18`. "Almost always" is exactly where the bare clock
   * lied, and the page filtered to Dead letter is the page whose rows are old.
   */
  createdAtClock: string
  /** e.g. `3/5`, or `-` when the endpoint reported no attempt count. */
  attempts: string
  attemptsAtMax: boolean
  /**
   * Whether the line under the status says anything at all. A row on its first
   * attempt that has never failed has nothing to report, and `1/5` down twenty
   * rows is twenty repetitions of "nothing has gone wrong".
   */
  showAttempts: boolean
  /** Whether a failure was actually recorded — the sub-line's second half. */
  hasFailure: boolean
  /** Relative like `createdAt`, or `-` when the row has never failed. */
  lastFailureAt: string
  /**
   * The failure sub-line's `title`: the attempt count in words above the two
   * absolute spellings of the instant, because the line itself says `5/5 · 4h
   * 24m ago` and neither half of that is quotable.
   */
  failureTitle: string
  /**
   * Why the last attempt failed, cut to the width the status column can hold.
   * Null on a row that carries no error — which is every healthy row, and also
   * a row that failed before the endpoint recorded a reason.
   */
  errorMessage: string | null
  /** The error's class, its whole message and when it happened. Null with it. */
  errorTitle: string | null
  /**
   * How long the event took, from created to completed: `430ms`, `1.2s`,
   * `3m 12s`. Null unless both instants exist, which in practice means the
   * completed rows and only them. A queue's whole job is to be quick, and a
   * page of Completed rows that never said how quick was a page reporting that
   * nothing was wrong without ever saying how well anything went.
   */
  latency: string | null
  /**
   * This row's key as the batch form submits it: `service:box:id`. Only ever
   * put on the page for a dead letter — the one status the batch acts on.
   */
  selectValue: string
  /** The raw status, kept for the status `title` and for `?status=`. */
  status: string
  /** The same status as a human reads it: `Dead letter`, `Published`. */
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  /**
   * The one state a row is worth colouring for. Every other status says itself
   * with a small dot and a muted word, so the tint the template hangs off this
   * is the only saturated area on a calm page.
   */
  isDeadLetter: boolean
  /**
   * Whether an operator set this row aside, and why. The status column already
   * says `Parked`; this is the sentence under it, because the word alone
   * answers "what state is it in?" and leaves the only question anybody
   * actually has about a parked event — why — two clicks away. The reason is
   * on the title rather than on the row: it is a sentence somebody typed, and
   * the status column holds eleven rems.
   */
  parked: boolean
  parkedTitle: string | null
}

/**
 * The failure the page is narrowed to, said back to the operator.
 *
 * `?error=` is the narrowest filter this page has and the only one that arrives
 * by being clicked rather than chosen — the top-failures panel applies it — so
 * without a line in the strip an operator would be reading a page filtered to
 * one message with nothing on screen saying so, and every count above it would
 * be a statement about a set they cannot see the shape of. Said and dismissed
 * exactly as the search is, because it is the same kind of thing.
 */
export interface ErrorNote {
  /** The first sixty characters of the message; the strip has one line. */
  label: string
  /** The whole message, for anyone who needs to read or copy it. */
  title: string
  /** The same page with the failure filter taken off it. */
  clearHref: string
}

/**
 * One rung of the preset ladder, as a link.
 *
 * The range boxes take an instant to the second and are the right control for
 * "between these two moments on Tuesday". They are the wrong control for the
 * question this page is opened with — "what has broken since I went to
 * lunch?" — which took two datetime pickers, a mental conversion into UTC and
 * a submit. Each of these is that question as a link.
 *
 * Each sets `from` and clears `to`: a window that ends is a window an operator
 * chose deliberately, and `last hour` means up to now by definition.
 */
export interface TimeRangePreset {
  /** `24h` — the key that travels as `?range=`. */
  key: string
  /** `Last 24h`, as the button and the list both say it. */
  label: string
  href: string
  title: string
  active: boolean
}

/**
 * The whole time-range control: one button saying what window the page is
 * asking about, and the panel behind it.
 *
 * The button reads as the answer to "what am I looking at?" — `Last 24h`, an
 * absolute pair, or `Any time` — which is the thing four separate controls in
 * a filter row never said in one place.
 */
export interface TimeRange {
  /** What the button says: `Any time`, `Last 24h`, or the absolute pair. */
  label: string
  /** The same, spelled out for the button's `title`. */
  title: string
  /** Whether any window is set at all, so the button can read as a filter. */
  active: boolean
  presets: TimeRangePreset[]
  /** The rung that clears the window, drawn with the others. */
  anyTimeHref: string
  anyTimeActive: boolean
}

/**
 * One failure, and every dead letter it caused.
 *
 * The list is ordered by time, twenty rows at a stretch, and a queue with seven
 * thousand dead letters in it is not seven thousand incidents — it is usually
 * three. Which three is not a question the list can answer at any length,
 * because the answer is spread across three hundred pages of it.
 */
export interface FailureGroup {
  /** The message, cut to what one line of the panel holds. */
  message: string
  /** The whole message — the string an operator greps a log for. */
  messageTitle: string
  /**
   * Whether the group has a message at all. The ones that recorded none are
   * still counted — they are dead letters like any other — but they cannot be
   * isolated by a filter that matches on a message, and the panel says so
   * rather than drawing a link that would quietly answer a wider question.
   */
  hasError: boolean
  /**
   * Null for the group of rows that store no type at all — audit records — and
   * the cell is then left empty. The failure message beside it is what names
   * the group; the type is the extra fact, not the identity.
   */
  type: string | null
  count: number
  /** Locale-grouped: `4,182`. */
  countLabel: string
  /** How long this failure has been happening, and when it last did. */
  firstAt: string
  firstTitle: string
  lastAt: string
  lastTitle: string
  /** The same page narrowed to this one failure. */
  href: string
}

/**
 * The panel above the table: which failures the dead letters actually are.
 *
 * Open when the page is already about dead letters, and folded shut when it is
 * not — a page an operator opened to look at something else should not have a
 * summary of the queue's worst day pushed into it, but it should say that the
 * summary is there.
 */
export interface TopFailures {
  groups: FailureGroup[]
  count: number
  /** `Top failures (3 groups)` — the whole of the folded state. */
  summary: string
  open: boolean
  /** At least one group recorded no message, and cannot be linked to. */
  hasUnattributed: boolean
}

/**
 * The offer to redrive every dead letter behind the current filters.
 *
 * Only ever drawn on a page that is already narrowed to dead letters, because
 * the write it leads to acts on the filters and nothing else: a button that
 * said `Redrive all` on a page showing every status would be a button whose
 * scope an operator has to work out from the toolbar.
 */
export interface RedriveAll {
  /** `Redrive all 7,064 matching`. */
  label: string
  /** The confirmation, carrying the same filters the count was read under. */
  href: string
  title: string
}

/**
 * One segment of one filter control: a word, and how many events are behind
 * it.
 *
 * The figure is the point. A toolbar of seven status words told an operator
 * which slices exist and nothing about which of them is worth opening, and the
 * one number they came for — how many dead letters are behind this filter —
 * lived in a strip below, in a second control saying the same seven words. The
 * count is on the segment now, and the strip is gone.
 */
export interface FilterChip {
  /** The wire value this segment selects; null on `All`, which selects none. */
  value: string | null
  label: string
  href: string
  /** This is the slice on screen — the segment is a mark, not an offer. */
  active: boolean
  /**
   * Locale-grouped: `7,064`. A raw `7064` is a figure nobody reads at 12px.
   * Null when the counts could not be read at all, and the control then draws
   * the labels it always had: a summary that failed has not made the filter
   * beneath it an error, and there is nothing here worth an alert.
   */
  countLabel: string | null
  /**
   * Nothing behind this segment. Dimmed, and still a link: a segment that
   * vanished when it emptied could not be told from one the page had forgotten
   * to draw, and `Failed 0` is the most reassuring thing on this page.
   */
  zero: boolean
  /**
   * The one figure in the toolbar allowed any colour at all — the dead
   * letters, and only while there are some. A zero is not an alarm.
   */
  alarming: boolean
  /**
   * What the state means, on the segment's own title. Seven states named in
   * one word each is a vocabulary an operator is expected to already have, and
   * the two pairs that matter — Failed against Dead letter, Published against
   * Resubmitted — are exactly the ones the words do not distinguish. Null on
   * the segments that name a service, which need no gloss, and on a
   * status this app has never seen.
   */
  title: string | null
}

/** One filter re-stated as a hidden field on the search form. */
export interface SearchFilter {
  name: string
  value: string
}

export interface EventsPageModel {
  /** Every row on the page, in the endpoint's order. One row per event. */
  rows: EventRow[]
  /**
   * All · Published · … · Dead letter · Parked, in the order a message travels
   * through them, each carrying its count across the current filters.
   */
  statusFilters: FilterChip[]
  /** All · GAS · Caseworking, each carrying its own facet's count. */
  serviceFilters: FilterChip[]
  /**
   * How many events every filter on the page selects, formatted and worded:
   * `243,297 events`. Stated over the table rather than on a filter, because
   * it is the one number that answers to all of them at once - and null when
   * the counts could not be read, so the table simply carries no figure.
   */
  eventsTotal: string | null
  /** What the page is searched for, trimmed, or null when it is not. */
  q: string | null
  /** The same page with the search taken off it, for the `Clear` links. */
  clearSearchHref: string
  /** The failure the page is narrowed to, or null when it is not. */
  errorFilter: ErrorNote | null
  /**
   * The time-range dropdown: what it says, and everything behind it. It is the
   * only place the active window is stated - it used to be said a second time
   * in the filter strip below, back when the range had no control of its own
   * carrying its value.
   */
  timeRange: TimeRange
  /**
   * Which failures the dead letters are, folded above the table. Null when
   * there are none to report, when the read failed, and on every page that is
   * not about dead letters — the panel is silent rather than empty.
   */
  topFailures: TopFailures | null
  /** The bulk write, on a page narrowed to dead letters. Null everywhere else. */
  redriveAll: RedriveAll | null
  /**
   * The filters the search box has to carry through a submission. A GET form
   * sends its own fields and nothing else, so every filter the toolbar holds
   * is re-stated as a hidden field or searching quietly widens the page to
   * All. `cursor` and `direction` are deliberately not among them: a keyset
   * position taken over the whole stream means nothing over a search of it.
   */
  searchFilters: SearchFilter[]
  /**
   * The same trick for the absolute-range form inside the dropdown, which
   * carries the search rather than the window: it is the one control on the
   * page whose whole job is to REPLACE the window, so it deliberately restates
   * neither `from`/`to` — its own two boxes are those — nor `range`, whose
   * label would otherwise outlive the preset it names.
   */
  rangeFilters: SearchFilter[]
  /** The From box's value, in the spelling `datetime-local` reads and writes. */
  fromInput: string
  /** The To box's, the same way. Both empty on a page with no range on it. */
  toInput: string
  previousHref: string | null
  nextHref: string | null
  /** `CW · Inbox, CW · Outbox` — empty when every source answered. */
  unavailableSources: string
  /** Nothing could be read at all. */
  unavailable: boolean
  /**
   * Whether any row on this page is a dead letter. The batch control is drawn
   * only where there is something for it to act on: a `Redrive selected`
   * button above a page of healthy rows is a button that can only ever be
   * pressed by mistake.
   */
  hasDeadLetters: boolean
  /** Where the batch form posts. */
  redriveBatchAction: string
  /** This page's own query, for the batch form to carry back out of the flow. */
  currentSearch: string
}

/**
 * The line under the status is only drawn when the count says something: a row
 * still on its first attempt that has never failed leaves it off rather than
 * printing `1/5` down twenty rows.
 */
const showsAttempts = (attempts: number | null | undefined, failed: boolean) =>
  failed || (attempts != null && attempts > 1)

/**
 * Attempts and Last failure are one line under the status — `5/5 · 4h 24m ago`
 * — so they are one tooltip too. The count is spelled out in words because `5/5` is a
 * figure the eye reads and not a sentence, and the instant is spelled both
 * ways beneath it because a relative time is unquotable and a stale tab makes
 * it a lie. A row with no count to report says only the second line.
 */
const toFailureTitle = (
  attempts: string,
  showAttempts: boolean,
  failure: string
): string => {
  const counted =
    showAttempts && attempts !== '-'
      ? `${attempts.replace('/', ' of ')} attempts`
      : null

  return [counted, failure].filter((line) => line !== null).join('\n')
}

/**
 * The reason under the status, cut to what the column can hold. Long enough to
 * tell one failure from another — `MongoServerError: E11000 duplicate key` is
 * recognisable well inside it — and short enough that the row stays one line
 * taller than its neighbours rather than three. The whole message is on the
 * title.
 */
const displayedErrorChars = 64

const toShortMessage = (message: string): string =>
  message.length > displayedErrorChars
    ? `${message.slice(0, displayedErrorChars)}…`
    : message

/**
 * The failure in full: the error class and its whole message, then when it
 * happened. The class is on the title rather than on the page because it is
 * the half a developer greps for and the half an operator never reads.
 */
const toErrorTitle = (error: EventLastError, now: Date): string => {
  const at = error.at === null ? '' : toTimestamp(error.at, now).title

  return [`${error.name}: ${error.message}`, at]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * The park, as the status cell needs it: a word, and the reason on the title.
 *
 * The word is drawn rather than the reason because the reason is a sentence
 * somebody typed and the column holds eleven rems; the whole of it, with who
 * parked it and when, is one hover away. Both spellings of the instant are not
 * offered here — a parked event is not a thing anyone is timing.
 */
const toParked = (parked: Event['parked']) =>
  parked == null
    ? { parked: false, parkedTitle: null }
    : {
        parked: true,
        parkedTitle: [
          parked.reason,
          `Parked by ${parked.by}${parked.at ? ` at ${toAbsolute(parked.at) ?? parked.at}` : ''}`
        ].join('\n')
      }

/** The failure reason as the status cell needs it — or two nulls, together. */
const toReason = (error: EventLastError | null, now: Date) =>
  error === null
    ? { errorMessage: null, errorTitle: null }
    : {
        errorMessage: toShortMessage(error.message),
        errorTitle: toErrorTitle(error, now)
      }

/**
 * The list's own url, as one opaque string for the inspect page to hand back.
 * Every parameter is carried, cursor included: the operator is going one row
 * deep and coming straight back, and returning them to page one of a
 * twenty-row window they had scrolled three pages into is losing their place.
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

const toEventPageHref = (event: Event, from: string): string => {
  const href = toEventHref(event)

  return from === '' ? href : `${href}?from=${encodeURIComponent(from)}`
}

/**
 * One row's key, as the batch form carries it: `service:box:id`, which is the
 * endpoint's own three-part address for a message flattened into a single form
 * value. The route splits it back apart and validates each piece — nothing
 * here is trusted on the way in, exactly as nothing on a url is.
 */
const toSelectValue = ({ service, box, id }: Event): string =>
  `${service}:${box}:${id}`

/**
 * The hop, as a link to the slice of the list it belongs to.
 *
 * A service the filter bar has no chip for gets no link. The endpoint decides
 * what `?service=` means, and pointing an operator at a value it has never
 * heard of is a click that can only ever answer with an empty page — a plain
 * label is the honest rendering of a hop this page cannot narrow to.
 */
const toHopFilter = (service: string, query: EventsPageQuery) => {
  const filter = serviceFilters.find(({ value }) => value === service)

  return filter === undefined
    ? { hopHref: null, hopTitle: null }
    : {
        hopHref: toFilterHref({ ...query, service, cursor: undefined }),
        hopTitle: `Filter to ${filter.label}`
      }
}

const toRow =
  (now: Date, from: string, query: EventsPageQuery) =>
  (event: Event): EventRow => {
    const badge = toStatusBadge(event.status)
    const created = toTimestamp(event.createdAt, now)
    const failed =
      event.lastFailureAt === null
        ? noTimestamp
        : toTimestamp(event.lastFailureAt, now)
    const hasFailure = failed.text !== noTimestamp.text
    const attempts = toAttempts(event.attempts, event.maxAttempts)
    const showAttempts = showsAttempts(event.attempts, hasFailure)
    return {
      eventId: event.eventId,
      eventHref: toEventPageHref(event, from),
      type: event.type,
      ...toQueue(event),
      ...toHopFilter(event.service, query),
      createdAt: created.text,
      createdAtTitle: created.title,
      createdAtClock: toClockOf(event.createdAt, now),
      attempts,
      attemptsAtMax: isAtMaxAttempts(event.attempts, event.maxAttempts),
      showAttempts,
      hasFailure,
      lastFailureAt: failed.text,
      failureTitle: toFailureTitle(
        attempts,
        showAttempts,
        hasFailure ? failed.title : noTimestamp.title
      ),
      ...toReason(event.lastError, now),
      ...toParked(event.parked),
      latency: toLatency(event.createdAt, event.completedAt),
      selectValue: toSelectValue(event),
      status: event.status,
      statusLabel: toStatusLabel(event.status),
      statusRole: badge.role,
      statusRetrying: badge.retrying,
      isDeadLetter: event.status === 'DEAD_LETTER'
    }
  }

/** The wall clock of an instant the endpoint wrote, or nothing to draw. */
const toClockOf = (value: string, now: Date): string => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '' : toClock(date, now)
}

/**
 * Grouped, in the operator's own locale spelling: `7,064`. Six figures of
 * ungrouped digits at 12px is a string to be decoded rather than a number to
 * be read, and the difference between 7064 and 70640 at a glance is the whole
 * point of putting a figure on a segment.
 */
const counted = new Intl.NumberFormat('en-GB')

/**
/**
 * Which sources are missing, in the vocabulary the alert already uses. Any
 * source can fail, GAS included, so the alert names what is actually gone
 * rather than assuming Caseworking.
 */
const toUnavailableSources = (sourceErrors: SourceError[] = []): string =>
  sourceErrors.map(toSourceName).join(', ')

/**
 * The statuses the filter bar offers, in the order a message travels through
 * them, with the two ends of a dead letter's life last: one that still needs a
 * decision, and one that has had one. The endpoint may still pass a status
 * through that is not on this list — a `?status=` typed by hand, say — in
 * which case no segment is active, including All, which is the honest answer:
 * the page is filtered to none of these.
 *
 * Typed as the counts' own keys, because each segment now wears its count and
 * a status the toolbar offers that the endpoint does not count would be a
 * segment that could only ever say nothing.
 */
const statusFilters: (keyof EventCounts)[] = [
  'PUBLISHED',
  'PROCESSING',
  'FAILED',
  'RESUBMITTED',
  'COMPLETED',
  'DEAD_LETTER',
  'PARKED'
]

const serviceFilters: { value: EventService; label: string }[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * A filter link carries the *other* filter and nothing else. `cursor` and
 * `direction` are deliberately dropped: a keyset position taken in one filter
 * means nothing in another, so changing a filter starts the list again.
 */
/**
 * The filters, added to whatever the link already carries. The search is one
 * of them: narrowing by status while holding a reference must not silently
 * drop the reference.
 */
const addFilters = (
  params: URLSearchParams,
  { status, service, q, error, from, to, range }: EventsPageQuery
): URLSearchParams => {
  const fields: [string, string | undefined][] = [
    ['status', status],
    ['service', service],
    ['q', q],
    // The narrowest filter the page has, and it travels like any other: an
    // operator who reached this page from the failures panel and then clicked
    // Service · GAS is asking about that failure on GAS, not about GAS.
    ['error', error],
    // The window is a filter like any other: changing the status of a page
    // that is asking about last night must keep it asking about last night.
    ['from', from],
    ['to', to],
    // The label the range wears, and nothing the endpoint ever sees. It rides
    // along on every link for the same reason `from` does: changing the status
    // of a page asking about the last 24 hours must leave it saying so.
    ['range', range]
  ]

  for (const [name, value] of fields) {
    if (value) {
      params.set(name, value)
    }
  }

  return params
}

const toFilterHref = (query: EventsPageQuery): string =>
  toPathHref('/dev-ops/events', query)

/**
 * The same filters, on a path of this app's choosing. The bulk-redrive
 * confirmation is the second page they are ever put on, and it has to be given
 * exactly the query the count above the button was read under — anything
 * rebuilt by hand there is a second spelling of the filters, and two spellings
 * eventually disagree about what is being written to.
 */
const toPathHref = (path: string, query: EventsPageQuery): string => {
  const params = addFilters(new URLSearchParams(), query)

  return params.size ? `${path}?${params}` : path
}

/**
 * The figure a segment wears, or none at all.
 *
 * A count that could not be read is not an error worth a word on this page:
 * the segments are perfectly good filters without one, and an alert about a
 * summary above a table that rendered would be the loudest thing on screen
 * saying the least. So a null count draws the label the control always had.
 */
const toSegmentCount = (count: number | null) => ({
  countLabel: count === null ? null : counted.format(count),
  zero: count === 0
})

const toSum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

/**
 * The one figure in the toolbar allowed a colour at all: the dead letters, and
 * only while there are some. A red zero is an alarm about nothing.
 */
const isAlarming = (status: string, count: number | null): boolean =>
  status === 'DEAD_LETTER' && (count ?? 0) > 0

/**
 * A segment changes one axis and keeps everything else the page is holding —
 * search, range, the other two filters — so the whole query is spread and the
 * one value overridden. `cursor` and `direction` fall away because
 * `addFilters` never reads them: a keyset position taken under one filter
 * means nothing under another.
 *
 * The counts endpoint does not take `status` and never has: narrowing a status
 * breakdown by one status would answer with a figure and six zeroes. That
 * refusal is exactly what makes `counts` the status facet — every segment
 * below reports what selecting it would find, whatever is selected now.
 *
 * `All` carries no figure. It used to wear the sum of the six beside it, which
 * put the page's headline number inside one segment of one control: a filter
 * an operator changes constantly, and a number they read as the answer to
 * "how many events am I looking at?". Selecting a status left it unmoved,
 * because it is a facet, so the one figure that looked like the total was the
 * one figure the status filter did not change. It is a plain label now, and
 * the total is stated once, over the table it describes.
 */
/**
 * How many events the page is actually showing, across every filter on it —
 * the status included.
 *
 * This is the number the operator reads as "what am I looking at?", so it has
 * to move when any filter moves. `counts` is a facet and deliberately does
 * NOT: it answers what each status would find, whatever is selected. So the
 * total is the whole block summed when no status is chosen, and that status's
 * own figure when one is — which is the same arithmetic the endpoint used to
 * do and send back as `total`, one addition away from the numbers it was
 * derived from.
 *
 * Null when the counts could not be read at all: the table below is a perfectly
 * good table without a figure over it, and an alert about a summary would be
 * the loudest thing on a page that rendered.
 */
const toTotalOf = (counts: EventCounts, status?: string): number => {
  if (!status) {
    return toSum(statusFilters.map((known) => counts[known] ?? 0))
  }

  // A `?status=` this page has no segment for counts as none of them, which is
  // the same answer the toolbar gives it: no segment lights up either.
  const selected = statusFilters.find((known) => known === status)

  return selected ? (counts[selected] ?? 0) : 0
}

const toEventsTotal = (
  query: EventsPageQuery,
  facets: EventFacets | null
): string | null => {
  if (!facets) {
    return null
  }

  const total = toTotalOf(facets.counts, query.status)

  return `${counted.format(total)} ${total === 1 ? 'event' : 'events'}`
}

const toStatusChips = (
  query: EventsPageQuery,
  facets: EventFacets | null
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
    ...statusFilters.map((value) => {
      const count = counts === null ? null : (counts[value] ?? 0)

      return {
        value,
        label: toStatusLabel(value),
        href: toFilterHref({ ...query, status: value }),
        active: query.status === value,
        alarming: isAlarming(value, count),
        title: toStatusExplainer(value),
        ...toSegmentCount(count)
      }
    })
  ]
}

/**
 * The service segments are plain labels: two of them, named after the thing
 * they select, and a figure on each said nothing an operator was reading them
 * for. The STATUS row is where the arithmetic belongs — that is the control
 * you scan to find what is broken — and a second row of numbers beside it was
 * two kinds of counting in one toolbar.
 *
 * `toSegmentCount(null)` rather than an omitted key, so every chip on the page
 * has the same shape whether or not it wears a number.
 */
const toServiceChips = (query: EventsPageQuery): FilterChip[] => [
  {
    value: null,
    label: 'All',
    href: toFilterHref({ ...query, service: undefined }),
    active: !query.service,
    alarming: false,
    title: null,
    ...toSegmentCount(null)
  },
  ...serviceFilters.map(({ value, label }) => ({
    value,
    label,
    href: toFilterHref({ ...query, service: value }),
    active: query.service === value,
    alarming: false,
    title: null,
    ...toSegmentCount(null)
  }))
]

const toFields = (fields: [string, string | undefined][]): SearchFilter[] =>
  fields.flatMap(([name, value]) => (value ? [{ name, value }] : []))

/**
 * The filters the SEARCH form has to re-state as hidden fields, because a form
 * submits its own controls and nothing else: without them, searching from a
 * page filtered to Dead letter would quietly widen it to every status.
 * `cursor` and `direction` are not among them, exactly as on a filter link.
 *
 * The window is among them now. Its two boxes used to sit in this form and
 * submit themselves; they have moved into the time-range panel, so searching
 * would drop the range unless it travels as hidden fields — and `range` with
 * it, or a search from `Last 24h` would come back saying an absolute pair.
 */
const toSearchFilters = ({
  status,
  service,
  error,
  from,
  to,
  range
}: EventsPageQuery): SearchFilter[] =>
  toFields([
    ['status', status],
    ['service', service],
    // Restated for the same reason the two above it are: searching from a
    // page narrowed to one failure must not quietly widen it to all of them.
    ['error', error],
    ['from', from],
    ['to', to],
    ['range', range]
  ])

/**
 * And the filters the ABSOLUTE-RANGE form has to re-state, which are the same
 * list the other way round: it carries the search, and deliberately carries
 * neither `from`/`to` — its own two boxes are those — nor `range`, because
 * applying a window of your own is precisely what stops it being `Last 24h`.
 */
const toRangeFilters = ({
  status,
  service,
  error,
  q
}: EventsPageQuery): SearchFilter[] =>
  toFields([
    ['status', status],
    ['service', service],
    ['error', error],
    ['q', q]
  ])

/**
 * A page keeps the filter it was opened with. The cursor is only a keyset
 * position, so `status` and `service` have to be carried on the link or the
 * next page quietly widens to All.
 */
const toHref = (
  cursor: string | null,
  direction: 'forward' | 'backward',
  query: EventsPageQuery
): string | null => {
  if (!cursor) {
    return null
  }

  // The position first, then the filters: the cursor is what the link is for,
  // and a url reads as what it does before it reads as what it keeps.
  const params = addFilters(new URLSearchParams({ cursor, direction }), query)

  return `/dev-ops/events?${params}`
}

/** Both directions, each drawn only where the endpoint issued a cursor. */
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
 * The search as the whole page speaks of it: trimmed, and absent rather than
 * empty. A box submitted with nothing but spaces in it is not a search, and
 * quoting ` gld-9b2 ` back with its spaces reads as a different query from the
 * one the operator typed.
 */
const toSearch = (value: string | undefined): string | null => {
  const needle = value?.trim() ?? ''

  return needle === '' ? null : needle
}

/**
 * The value a `datetime-local` box can hold, from the instant the query
 * carries.
 *
 * The two spellings are not the same thing and this is the only place that
 * knows it: the box reads and writes `2026-06-16T09:00:00`, the endpoint reads
 * and writes `2026-06-16T09:00:00.000Z`, and the route between them is what
 * turns one into the other. A value that does not parse is handed back
 * untouched rather than blanked — the operator can see what they sent, and the
 * error alert beside it says what GAS made of it.
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
 * The failure the page is narrowed to. Said in the strip because it arrived by
 * being clicked — nothing on the toolbar shows it, and a filter an operator
 * cannot see is one they will not think to remove.
 */
const toErrorNote = (query: EventsPageQuery): ErrorNote | null => {
  const message = query.error

  if (!message) {
    return null
  }

  return {
    label:
      message.length > displayedFilterErrorChars
        ? `${message.slice(0, displayedFilterErrorChars)}…`
        : message,
    title: message,
    clearHref: toFilterHref({ ...query, error: undefined, cursor: undefined })
  }
}

const msPerSecond = 1000
const secondsPerMinute = 60
const minutesPerHour = 60
const hoursPerDay = 24
const msPerMinute = msPerSecond * secondsPerMinute

/**
 * The ladder, in the order an operator climbs it. Fifteen minutes is "is it
 * happening right now?", an hour is "what is happening?", six is a shift, a
 * day is "what happened overnight", a week is "is this new?" and a month is
 * "has this always been like this?" — and everything between them is what the
 * two absolute boxes in the same panel are for.
 */
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
 * A preset link writes an ABSOLUTE `from` — the instant the link was built —
 * because a relative window and a keyset cursor cannot both be true a minute
 * later. That makes the window unambiguous and the label unrecoverable: by the
 * time the page renders, `now` has moved on and `now - 24h` no longer equals
 * the `from` in the url, so no arithmetic here can tell `Last 24h` from an
 * absolute range that happens to look like one.
 *
 * So the link carries its own name. `?range=24h` is a label and nothing else:
 * this app reads it, the endpoint never sees it, and it changes no rows. It is
 * trusted only where it is consistent with the window it claims to name — a
 * `from` and no `to`, which is the shape every preset link produces — so a
 * hand-edited url says the honest absolute thing rather than the flattering
 * one.
 */
const toActivePreset = ({ from, to, range }: EventsPageQuery) =>
  from && !to
    ? timeRangePresets.find((preset) => preset.key === range)
    : undefined

/**
 * Each rung is a link that sets `from` and clears `to`, keeping every other
 * filter. The instant is computed at render: a link on a page left open for an
 * hour asks for the hour before it is clicked, not the hour before it was
 * drawn, because it is a url the browser resolves against nothing.
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
 * A window nobody chose off the ladder, said as the two instants it is.
 *
 * No zone on it. Every instant this page draws is UTC, so a label saying so
 * beside each one is a word repeated until nobody reads it — and this control
 * is narrow enough that the word was crowding out the figures. An open end is
 * named rather than blanked: `earliest` and `now` are what the endpoint
 * actually does with a missing bound.
 */
const toAbsoluteRangeLabel = (from?: string, to?: string): string => {
  const start = from ? toAbsoluteMinute(from) : 'earliest'
  const end = to ? toAbsoluteMinute(to) : 'now'

  return `${start} → ${end}`
}

/** What the page is asking about, in the fewest words that are still true. */
const toTimeRangeLabel = (query: EventsPageQuery): string => {
  const { from, to } = query

  if (!from && !to) {
    return 'Any time'
  }

  const preset = toActivePreset(query)

  return preset ? presetLabel(preset.key) : toAbsoluteRangeLabel(from, to)
}

/**
 * The whole control. One button that says which window is on, and a panel
 * holding the ladder and the two boxes that take any window at all.
 *
 * `Any time` is a rung like the others rather than a `Clear ×` off to one
 * side: "no window" is a choice about the range, and the one place an operator
 * looks to change the range is this list.
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
 * A failure message, cut to what one line of the panel holds. Ninety characters
 * is enough to tell `E11000 duplicate key error collection: gas.events index:
 * eventId_1` from the same error on another index, which is the distinction the
 * panel exists to draw; the whole message is on the title and travels whole on
 * the link.
 */
const displayedGroupErrorChars = 90

/** What a group with no message on it is called, said as a fact not a blank. */
const noErrorRecorded = '(no error recorded)'

const toGroupMessage = (message: string | null): string => {
  if (message === null) {
    return noErrorRecorded
  }

  return message.length > displayedGroupErrorChars
    ? `${message.slice(0, displayedGroupErrorChars)}…`
    : message
}

/**
 * One row of the panel: a failure, how many dead letters it has caused, and the
 * span it has been causing them over.
 *
 * The link is the point of the row. It applies `?status=DEAD_LETTER&error=<the
 * whole message>` — the message verbatim, because the endpoint matches it
 * exactly and a truncated needle would answer a question nobody asked — and
 * keeps every filter the panel was computed under. A group that recorded no
 * message links to the dead letters without an `error` at all: it is the honest
 * link, and the panel says in words that those cannot be isolated.
 */
const toFailureGroup =
  (query: EventsPageQuery, now: Date) =>
  (group: EventBreakdownGroup): FailureGroup => {
    const first = toTimestamp(group.firstAt, now)
    const last = toTimestamp(group.lastAt, now)

    return {
      message: toGroupMessage(group.error),
      messageTitle: group.error ?? noErrorRecorded,
      hasError: group.error !== null,
      type: group.type,
      count: group.count,
      countLabel: counted.format(group.count),
      firstAt: first.text,
      firstTitle: first.title,
      lastAt: last.text,
      lastTitle: last.title,
      href: toFilterHref({
        ...query,
        status: 'DEAD_LETTER',
        error: group.error ?? undefined,
        cursor: undefined
      })
    }
  }

/**
 * Whether the panel is open, folded, or not there at all.
 *
 * Open on a page that is already about dead letters: the operator is looking at
 * them, and the shape of them is the next thing they need. Folded on a page
 * with no status filter that has dead letters behind it — the summary is worth
 * announcing but not worth pushing the table down for. Absent on every other
 * page, including one filtered to a status this panel could say nothing about.
 */
/** How many dead letters are behind the current filters, or none at all. */
const toDeadLetterCount = (facets: EventFacets | null): number =>
  facets?.counts.DEAD_LETTER ?? 0

const isDeadLetterPage = (query: EventsPageQuery, facets: EventFacets | null) =>
  query.status === 'DEAD_LETTER' ||
  (!query.status && toDeadLetterCount(facets) > 0)

/** `Top failures (3 groups)` — the whole of the folded state. */
const toFailuresSummary = (count: number): string =>
  `Top failures (${count} group${count === 1 ? '' : 's'})`

const toTopFailures = (
  breakdown: EventBreakdownPage | null,
  facets: EventFacets | null,
  query: EventsPageQuery,
  now: Date
): TopFailures | null => {
  const groups = breakdown === null ? [] : breakdown.groups

  if (groups.length === 0 || !isDeadLetterPage(query, facets)) {
    return null
  }

  return {
    groups: groups.map(toFailureGroup(query, now)),
    count: groups.length,
    summary: toFailuresSummary(groups.length),
    open: query.status === 'DEAD_LETTER',
    hasUnattributed: groups.some((group) => group.error === null)
  }
}

/**
 * The bulk write, offered only where its scope is on screen.
 *
 * The figure is the dead-letter count under the current filters — the same
 * number the Dead letter segment beside it wears — because that is precisely
 * the set the write will act on. With no counts there is no figure, and a
 * button that could not say how many events it was about is a button nobody
 * should press.
 */
const toRedriveAll = (
  facets: EventFacets | null,
  query: EventsPageQuery
): RedriveAll | null => {
  const count = toDeadLetterCount(facets)

  if (query.status !== 'DEAD_LETTER' || count === 0) {
    return null
  }

  return {
    label: `Redrive all ${counted.format(count)} matching`,
    href: toPathHref('/dev-ops/events/redrive-query-confirm', {
      ...query,
      cursor: undefined,
      direction: undefined
    }),
    title: `Redrive every dead letter matching the current filters (up to 500 per run)`
  }
}

/**
 * @param now Injected so the relative times a test asserts on are the times it
 *   set up; the page itself renders against the clock at request time.
 */
export const toEventsPage = (
  { page, facets, breakdown, unavailable }: EventsResult,
  query: EventsPageQuery,
  now: Date = new Date()
): EventsPageModel => {
  const { events, pagination, sourceErrors } = page
  const currentSearch = toCurrentSearch(query)
  const q = toSearch(query.q)
  // Every link on the page is built from the trimmed search, so a stray space
  // cannot make two spellings of one query paginate differently. The rows are
  // built from it too now: each one links its hop to this same page narrowed
  // to that service, and a row's link and a chip's link have to agree.
  const filters: EventsPageQuery = { ...query, q: q ?? undefined }
  const rows = events.map(toRow(now, currentSearch, filters))

  return {
    // One row per event, in the endpoint's own order. The page used to fold
    // runs of identical rows into openable groups; it does not any more, so a
    // row is the only unit here and the one every other part of the page
    // counts in.
    rows,
    eventsTotal: toEventsTotal(filters, facets),
    statusFilters: toStatusChips(filters, facets),
    serviceFilters: toServiceChips(filters),
    q,
    clearSearchHref: toFilterHref({ ...filters, q: undefined }),
    errorFilter: toErrorNote(filters),
    timeRange: toTimeRange(filters, now),
    topFailures: toTopFailures(breakdown, facets, filters, now),
    redriveAll: toRedriveAll(facets, filters),
    searchFilters: toSearchFilters(filters),
    rangeFilters: toRangeFilters(filters),
    fromInput: toLocalInput(query.from),
    toInput: toLocalInput(query.to),
    ...toPagerHrefs(pagination, filters),
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable,
    hasDeadLetters: rows.some((row) => row.isDeadLetter),
    redriveBatchAction: '/dev-ops/events/redrive-batch',
    currentSearch
  }
}
