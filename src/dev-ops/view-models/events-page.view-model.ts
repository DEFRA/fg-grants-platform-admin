import { config } from '../../common/config.ts'
import type {
  Event,
  EventsQuery,
  EventsResult,
  SourceError
} from '../use-cases/get-events.use-case.ts'

/**
 * The status roles this page uses, named by meaning rather than by class. Each
 * one is a colour of dot and a weight of label; the literal classes live in
 * status-badge/template.njk, because Tailwind scans views/ for candidates and a
 * class name spelled only in TypeScript is purged from the stylesheet without a
 * word of warning.
 */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

export interface EventRow {
  /** The whole id, for the `title` of the truncated one. */
  eventId: string
  /** The first group of a uuid and an ellipsis: `4e5c49be…`. */
  eventIdShort: string
  /** As the Event column says it: `audit · case.create_case`, lowercased. */
  type: string
  /**
   * The endpoint's own spelling, for the `title` — and only when the two
   * differ. A tooltip that repeats the text under the cursor is noise, so a
   * type the page shows verbatim carries none.
   */
  typeTitle: string | null
  segregationRef: string | null
  /** The Route cell's first name: `Agreements` of `Agreements → GAS`. */
  routeFrom: string
  /** Its second: `GAS`. Split so the arrow between them can recede. */
  routeTo: string
  /**
   * Whether that second name is a topic rather than a service. An outbox row
   * whose topic fits no naming convention has no service to point at, and the
   * page used to point it at an ellipsis — a row that said nothing at all. The
   * topic *is* the destination in that case, so it is set in mono and the
   * `(via …)` suffix that would repeat it is dropped.
   */
  routeToIsTopic: boolean
  /** The raw topic behind a stripped one, for the `title`. Null otherwise. */
  routeToTitle: string | null
  /** The whole suffix, for the `title`: `via cw__sns__update_status_fifo`. */
  routeDetail: string
  /**
   * The same suffix with the routing prefix dropped and the topic cut to a
   * length the column can hold: `via update_status_fifo`. The parentheses
   * around it belong to the template, not to the value.
   */
  routeDetailShort: string
  /** Relative, computed at render time: `22m ago`, `3h 12m ago`, `2d ago`. */
  createdAt: string
  /** `2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)` */
  createdAtTitle: string
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
  /** The full `trace.id`, for the link's title. Null when there is no trace. */
  traceId: string | null
  /**
   * Deep link into the CDP OpenSearch Discover view, pre-filtered to this
   * event's trace and windowed around it. Null when the row has no trace id,
   * or when `logs.explorerBaseUrl` is unset, which switches the feature off.
   */
  traceHref: string | null
}

/**
 * A run of consecutive rows the endpoint returned that say the same thing: the
 * same type, reference, status, route and box. A retry storm writes eight of
 * them in a row and they cost eight rows of an operator's attention to learn
 * one fact, so the page folds them into one line that can be opened.
 *
 * A run of one is still a group — the template renders it as a plain row — so
 * the view has exactly one list to walk rather than two interleaved ones.
 */
export interface EventGroup {
  /** The members, in the order the endpoint returned them. */
  rows: EventRow[]
  /** Two or more: the group is drawn as a `<details>` rather than as a row. */
  grouped: boolean
  count: number
  /** `×8`, for the chip on the summary row. */
  countLabel: string
  /** What the chip is counting, spelled out for its `title`. */
  countTitle: string
  /** The summary's own `title`: what clicking the row will do. */
  expandTitle: string
  /** A `name` for the `<details>`, unique so groups open independently. */
  name: string
  /** The shared facets, the ones the group key is taken from. */
  type: string
  typeTitle: string | null
  segregationRef: string | null
  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  isDeadLetter: boolean
  routeFrom: string
  routeTo: string
  routeToIsTopic: boolean
  routeToTitle: string | null
  routeDetail: string
  routeDetailShort: string
  /**
   * The newest member's age, in exactly the format and size a plain row uses:
   * `3h 32m ago`. The span the group actually covers is on the title.
   */
  createdAt: string
  createdAtTitle: string
  /** The shared count, or `1–5/5` when the members do not agree. */
  attempts: string
  attemptsAtMax: boolean
  showAttempts: boolean
  hasFailure: boolean
  /** The newest failure in the group. */
  lastFailureAt: string
  failureTitle: string
}

/** One count in the rollup strip: `20 dead-lettered`. */
export interface RollupBucket {
  label: string
  count: number
  /**
   * The one bucket whose number may carry colour. Every other count in the
   * strip is set in one weight, because a strip of four differently-coloured
   * figures is four alarms; this one is the page's subject.
   */
  deadLettered: boolean
}

/**
 * What is on screen, counted. Deliberately not a summary of the stream: this
 * page holds one keyset page and no total exists, so every number here is
 * qualified by "on this page" and nothing is extrapolated.
 */
export interface EventsRollup {
  /** Only the buckets that actually have something in them. */
  buckets: RollupBucket[]
  /** The oldest row's relative age, or null on an empty page. */
  oldest: string | null
  oldestTitle: string
}

/** One link in the filter bar. `active` is derived from the current query. */
export interface FilterChip {
  label: string
  href: string
  active: boolean
}

export interface EventsPageModel {
  /** Every row on the page, flat, in the endpoint's order. */
  rows: EventRow[]
  /** The same rows, folded into runs of consecutive identical ones. */
  groups: EventGroup[]
  /**
   * How many of those runs actually fold — a run of one is drawn as a plain
   * row and is no more a "group" to the operator than any other line. Zero
   * when the page folded nothing, which is what silences every mention of
   * groups on the page rather than printing `0 groups`.
   */
  groupCount: number
  /** How many rows are on screen. The same number the pager counts. */
  eventCount: number
  rollup: EventsRollup
  /** All · Published · … · Dead letter, in the order an operator reads them. */
  statusFilters: FilterChip[]
  /** All · GAS · Caseworking. */
  serviceFilters: FilterChip[]
  previousHref: string | null
  nextHref: string | null
  /** `CW · Inbox, CW · Outbox` — empty when every source answered. */
  unavailableSources: string
  /** Nothing could be read at all. */
  unavailable: boolean
}

const serviceLabels: Record<string, string> = { gas: 'GAS', caseworking: 'CW' }
const boxLabels: Record<string, string> = { inbox: 'Inbox', outbox: 'Outbox' }

/**
 * The Route cell reads in full names — the short codes belong to the topic
 * strings on the line beneath it, not to the sentence a human reads first.
 * `?` is the placeholder for a hop the row does not name.
 */
const fullNames: Record<string, string> = {
  GAS: 'GAS',
  CW: 'Caseworking',
  AS: 'Agreements',
  AUDIT: 'Audit',
  '?': 'unknown'
}

const toFullName = (label: string): string => fullNames[label] ?? label

/**
 * Colour and the retry glyph, by status.
 *
 * `PUBLISHED` is queued and healthy, so it is deliberately quiet; `PROCESSING`
 * is in flight; amber is reserved for the two states that are actually
 * retrying, which is what an operator is scanning for. A status the endpoint
 * passes through that we have never seen falls to `neutral` rather than to a
 * blank cell — an unknown state is still worth seeing.
 */
const statusBadges: Record<string, { role: BadgeRole; retrying: boolean }> = {
  PUBLISHED: { role: 'neutral', retrying: false },
  PROCESSING: { role: 'info', retrying: false },
  FAILED: { role: 'warning', retrying: true },
  RESUBMITTED: { role: 'warning', retrying: true },
  COMPLETED: { role: 'success', retrying: false },
  DEAD_LETTER: { role: 'error', retrying: false }
}

const unknownStatus = { role: 'neutral' as BadgeRole, retrying: false }

/**
 * The wire spells its statuses in screaming snake case; a table of them reads
 * as a table of shouting. Each is written here as a human says it, once, for
 * both the badge and the filter chip that names the same slice — the raw value
 * still travels on `?status=` and on the badge's `title`.
 *
 * A status we have never seen keeps the endpoint's own spelling: an invented
 * sentence case for it would only hide the string worth grepping for.
 */
const statusLabels: Record<string, string> = {
  PUBLISHED: 'Published',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  RESUBMITTED: 'Resubmitted',
  COMPLETED: 'Completed',
  DEAD_LETTER: 'Dead letter'
}

const toStatusLabel = (status: string): string => statusLabels[status] ?? status

/**
 * Europe/London with the zone abbreviation, built once. The zone is named
 * explicitly rather than taken from the process, so the same string is
 * rendered on a UTC container as on a developer's laptop.
 */
const londonTimestamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short'
})

const msPerSecond = 1000
const secondsPerMinute = 60
const minutesPerHour = 60
const hoursPerDay = 24

/**
 * How long ago, in the coarsest unit that still says something useful. Under a
 * minute counts seconds, under an hour counts minutes, under a day carries the
 * spare minutes, and past that a day count is all anyone reads.
 */
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

interface Timestamp {
  text: string
  title: string
}

/** Nothing to say, and nothing to hover: a row that has never failed. */
const noTimestamp: Timestamp = {
  text: '-',
  title: 'No failure recorded'
}

/**
 * Relative on the page, absolute in the tooltip. The title carries both the
 * ISO instant a developer pastes into a log query and the Europe/London
 * wall-clock time the operator is thinking in, because a relative time alone
 * is unquotable and a stale tab makes it a lie.
 */
const toTimestamp = (value: string, now: Date): Timestamp => {
  const date = new Date(value)

  // Intl throws on an unparseable date; a dash is more use than a 500.
  if (Number.isNaN(date.getTime())) {
    return { text: '-', title: '' }
  }

  return {
    text: toRelative(date, now),
    title: `${date.toISOString().replace('.000', '')}   ·   ${londonTimestamp.format(date)} (Europe/London)`
  }
}

/** `GAS · Inbox` — the half of the label the alert and the table share. */
const toSourceName = ({ service, box }: { service: string; box: string }) =>
  `${serviceLabels[service] ?? service} · ${boxLabels[box] ?? box}`

/**
 * The topic naming convention both services write to: the prefix states the
 * service the message lands in.
 */
const topicPrefixes = [
  { prefix: 'cw__', destination: 'CW' },
  { prefix: 'gas__', destination: 'GAS' }
]

/**
 * Where a topic name points. Anything the convention does not cover is named
 * as the endpoint wrote it rather than flattened to "unknown", which would
 * hide the one string a developer would want to grep for.
 */
const toNamedTarget = (target: string): string =>
  topicPrefixes.find(({ prefix }) => target.startsWith(prefix))?.destination ??
  (target === 'audit' ? 'AUDIT' : target)

/** `internal` never leaves the service that wrote it; no target at all is `?`. */
const toDestination = (target: string | null, own: string): string => {
  if (!target) {
    return '?'
  }

  return target === 'internal' ? own : toNamedTarget(target)
}

/**
 * The half of a topic name that says nothing the row has not already said:
 * `cw__sns__`, `gas__sqs__` — the destination service and the transport, both
 * of which the Route sentence beside it names in full. Cutting a topic to
 * eighteen characters *with* the prefix spent them all on that preamble and
 * threw away the suffix that tells one queue from another, so the prefix goes
 * before the cut rather than after it: `(via audit_topic_arn)`.
 */
const topicPrefix = /^[^\s]*?__(?:sns|sqs)__/

const toBareTopic = (topic: string): string => topic.replace(topicPrefix, '')

/**
 * The topic on the end of an outbox route, cut to what the column holds. The
 * whole of it, prefix and all, is on the cell's `title`.
 *
 * Twenty-six characters rather than eighteen: the cut has to clear a name plus
 * the `.fifo` a queue's five-character suffix costs —
 * `create_new_case_fifo.fifo` is a real topic and cutting it at 24 would take
 * off the very thing that identifies it.
 */
const displayedTopicChars = 26

const toShortTopic = (topic: string): string => {
  const bare = toBareTopic(topic)

  return bare.length > displayedTopicChars
    ? `${bare.slice(0, displayedTopicChars)}…`
    : bare
}

/**
 * An inbox row was written by whoever produced it and points at the service
 * holding it, so line two names the box it is sitting in — `gas inbox` rather
 * than a lone `inbox`, which said nothing the row did not already say. A box
 * we have no shape for reads the same way, under its own name.
 */
const toInboxRoute = (source: string | null, own: string, box: string) => ({
  routeFrom: toFullName(source ?? '?'),
  routeTo: toFullName(own),
  routeToIsTopic: false,
  routeToTitle: null,
  routeDetail: `${own.toLowerCase()} ${box}`,
  routeDetailShort: `${own.toLowerCase()} ${box}`
})

/**
 * An outbox row is owned by the service that wrote it and points at a topic.
 * Line two is the topic alone: the arrow above already says it left, so the
 * word `outbox` was only taking room from the string worth reading.
 *
 * When the topic fits none of the naming conventions there is no service on
 * the far end of the arrow to name, and a route that reads `GAS → …` is a
 * sentence with its object cut off. The topic is then the destination: it goes
 * on the arrow, stripped of its transport prefix and set in mono because it is
 * a machine string, and the `(via …)` suffix — which would say the same thing
 * a second time — is dropped. The raw topic is on the title.
 */
/** A destination the naming convention could not name is the topic itself. */
const isTopicDestination = (target: string | null, destination: string) =>
  target !== null && destination === target

/** The topic on the arrow, and no suffix behind it to say it twice. */
const toTopicRoute = (target: string, own: string) => ({
  routeFrom: toFullName(own),
  routeTo: toBareTopic(target),
  routeToIsTopic: true,
  routeToTitle: target,
  routeDetail: `via ${target}`,
  routeDetailShort: ''
})

/** A named service on the arrow, with the topic as a parenthetical after it. */
const toNamedRoute = (
  target: string | null,
  own: string,
  destination: string
) => ({
  routeFrom: toFullName(own),
  routeTo: toFullName(destination),
  routeToIsTopic: false,
  routeToTitle: null,
  routeDetail: `via ${target ?? '-'}`,
  routeDetailShort: `via ${toShortTopic(target ?? '-')}`
})

const toOutboxRoute = (target: string | null, own: string) => {
  const destination = toDestination(target, own)

  return isTopicDestination(target, destination)
    ? toTopicRoute(target as string, own)
    : toNamedRoute(target, own, destination)
}

/** The names and the suffix of the Route cell's one line. */
const toRoute = ({ service, box, source, target }: Event) => {
  const own = serviceLabels[service] ?? service

  return box === 'outbox'
    ? toOutboxRoute(target, own)
    : toInboxRoute(source, own, box)
}

// Both counts are nullable on the wire, so neither is assumed.
// Defensive: the contract says both are always integers, but a wrong answer here is silent.
const toAttempts = (attempts?: number | null, maxAttempts?: number | null) =>
  attempts == null ? '-' : `${attempts}/${maxAttempts ?? '?'}`

const isAtMaxAttempts = (
  attempts?: number | null,
  maxAttempts?: number | null
) => attempts != null && maxAttempts != null && attempts >= maxAttempts

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
 * The index pattern the Discover link resolves against — the shared CDP logs
 * pattern, taken from a working Discover url. The link deliberately opens
 * plain Discover on this pattern rather than a per-service saved search, so
 * one click shows the trace across every service that logged it; the
 * `container_name` column says which service wrote each line.
 */
const indexPattern = 'e55f3890-5d4a-11ee-8f40-670c9b0b8093'

const traceWindowMs = 6 * minutesPerHour * secondsPerMinute * msPerSecond

/**
 * Enough of the id to recognise the row you were looking at, and no more: the
 * whole thing is on the `title`, and the type beside it is what the eye
 * actually scans. Eight characters is the first group of a uuid, so the cut
 * lands on a boundary the reader can see rather than mid-group — `4e5c49be…`
 * reads as an id, `4e5c49be-111…` reads as a truncation.
 */
const displayedEventIdChars = 8

const toShortEventId = (eventId: string): string =>
  eventId.length > displayedEventIdChars
    ? `${eventId.slice(0, displayedEventIdChars)}…`
    : eventId

/**
 * One identifier grammar in the Event column. A message type is already
 * lowercase and dotted — `case.status.updated` — and an audit row arrives
 * spelling the same idea in screaming snake: `audit · APPLICATION.CREATE`.
 * Two conventions in one column make the shouted one read as urgent, which it
 * is not, so the derived half is lowercased to match its neighbours. The
 * endpoint's own spelling stays on the `title`, which is where a grep or a
 * `?type=` needs it.
 */
const auditType = /^audit · (.+)$/

const toDisplayedType = (type: string): string => {
  const derived = auditType.exec(type)

  return derived === null ? type : `audit · ${derived[1].toLowerCase()}`
}

/** Nothing to hover when the column already shows the endpoint's spelling. */
const toTypeTitle = (type: string, displayed: string): string | null =>
  displayed === type ? null : type

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
 * every dynamic part of it is one trace id and two timestamps, and the rest is
 * a fixed blob lifted from a working query. `%22` is a literal here — the
 * kuery is `trace.id:"<id>"`, and its double quotes have to survive as
 * url-encoded characters inside the single-quoted rison string.
 */
const buildTraceHref = (
  base: string,
  traceId: string,
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
    `&_q=(filters:!(),query:(language:kuery,query:'trace.id:%22${toRisonString(traceId)}%22'))`
  )
}

/**
 * Two things have to be in place before a row is worth linking: a deployment
 * that names a logs explorer, and an event that actually carries a trace. The
 * link is the same shape for every service — cross-service by design, so the
 * whole journey of a trace is one click.
 */
const toTraceHref = (event: Event): string | null => {
  const base = config.get('logs.explorerBaseUrl') as string

  if (!base) {
    return null
  }

  return event.traceId === null
    ? null
    : buildTraceHref(base, event.traceId, event.createdAt)
}

const toRow =
  (now: Date) =>
  (event: Event): EventRow => {
    const badge = statusBadges[event.status] ?? unknownStatus
    const created = toTimestamp(event.createdAt, now)
    const failed =
      event.lastFailureAt === null
        ? noTimestamp
        : toTimestamp(event.lastFailureAt, now)
    const hasFailure = failed.text !== noTimestamp.text
    const attempts = toAttempts(event.attempts, event.maxAttempts)
    const showAttempts = showsAttempts(event.attempts, hasFailure)
    const type = toDisplayedType(event.type)

    return {
      eventId: event.eventId,
      eventIdShort: toShortEventId(event.eventId),
      type,
      typeTitle: toTypeTitle(event.type, type),
      segregationRef: event.segregationRef,
      ...toRoute(event),
      createdAt: created.text,
      createdAtTitle: created.title,
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
      status: event.status,
      statusLabel: toStatusLabel(event.status),
      statusRole: badge.role,
      statusRetrying: badge.retrying,
      isDeadLetter: event.status === 'DEAD_LETTER',
      traceId: event.traceId,
      traceHref: toTraceHref(event)
    }
  }

/**
 * What makes two rows the same event as far as an operator is concerned: the
 * same message, about the same thing, in the same state, going the same way.
 * Attempts and timestamps are deliberately *not* in the key — they are what
 * differs between the members of a retry storm, and keying on them would put
 * every row back in a group of its own.
 *
 * ` ` joins the parts because no field on the wire can contain it, so no
 * pair of different keys can collide by concatenation.
 */
const toGroupKey = (event: Event): string => {
  const { routeFrom, routeTo } = toRoute(event)

  return [
    event.type,
    event.segregationRef ?? '',
    event.status,
    `${routeFrom} → ${routeTo}`,
    event.box
  ].join(' ')
}

/**
 * Runs of *consecutive* identical rows, never a regroup of the page. The
 * endpoint's order is the operator's order — newest first — and hoisting a row
 * out of its place to sit with a match twelve rows above it would quietly
 * rewrite the timeline the page exists to show.
 */
const toRuns = (events: Event[]): Event[][] => {
  const runs: Event[][] = []
  let lastKey: string | null = null

  for (const event of events) {
    const key = toGroupKey(event)
    const run = runs.at(-1)

    if (run && key === lastKey) {
      run.push(event)
    } else {
      runs.push([event])
    }

    lastKey = key
  }

  return runs
}

/** Every parseable instant on a set of rows, as milliseconds. */
const toTimes = (values: (string | null)[]): number[] =>
  values
    .filter((value) => value !== null)
    .map((value) => new Date(value).getTime())
    .filter((time) => !Number.isNaN(time))

const toStamp = (time: number, now: Date): Timestamp =>
  toTimestamp(new Date(time).toISOString(), now)

/**
 * The group's age, said the way every other row on the page says it: the
 * newest member's relative time and nothing else. The Created column is read
 * as a column — one value per line, right-aligned against the same edge — and
 * a `3h 32m – 3h 38m ago` on the summaries made it ragged for the sake of a
 * span an operator rarely needs at a glance.
 *
 * The span is not lost, only demoted: it opens the title, above the two
 * absolute instants, for anyone who does need it.
 */
const toCreatedRange = (events: Event[], now: Date): Timestamp => {
  const times = toTimes(events.map((event) => event.createdAt))

  if (times.length === 0) {
    return { text: '-', title: '' }
  }

  const newest = toStamp(Math.max(...times), now)
  const oldest = toStamp(Math.min(...times), now)

  if (newest.text === oldest.text) {
    return newest
  }

  const span = `${newest.text.replace(/ ago$/, '')} – ${oldest.text}`

  return {
    text: newest.text,
    title: `${span}\nNewest: ${newest.title}\nOldest: ${oldest.title}`
  }
}

/** The newest failure in a group — the one that says whether it is still going. */
const toGroupFailure = (events: Event[], now: Date): Timestamp => {
  const times = toTimes(events.map((event) => event.lastFailureAt))

  return times.length === 0 ? noTimestamp : toStamp(Math.max(...times), now)
}

/**
 * The group's attempt count. Members of a retry storm normally share one, and
 * then it is stated plainly; when they do not, the range is stated rather than
 * one member's count being passed off as the group's.
 */
const toGroupAttempts = (events: Event[]) => {
  const counts = events
    .map((event) => event.attempts)
    .filter((attempts) => attempts != null)

  if (counts.length === 0) {
    return { attempts: '-', attemptsAtMax: false, highest: null }
  }

  const lowest = Math.min(...counts)
  const highest = Math.max(...counts)
  const limit = events[0].maxAttempts

  return {
    attempts: `${lowest === highest ? highest : `${lowest}–${highest}`}/${limit ?? '?'}`,
    // Darkened only when every member is at the limit: one straggler still
    // has a retry left, and the group has not finished failing.
    attemptsAtMax: isAtMaxAttempts(lowest, limit),
    highest
  }
}

const toGroup =
  (now: Date) =>
  (events: Event[], index: number): EventGroup => {
    const rows = events.map(toRow(now))
    const [first] = rows
    const created = toCreatedRange(events, now)
    const failed = toGroupFailure(events, now)
    const hasFailure = failed.text !== noTimestamp.text
    const { attempts, attemptsAtMax, highest } = toGroupAttempts(events)

    return {
      rows,
      grouped: rows.length > 1,
      count: rows.length,
      countLabel: `×${rows.length}`,
      countTitle: `${rows.length} events in this group`,
      expandTitle: `Click to expand ${rows.length} events`,
      // Unique per group, so opening one never closes another: an operator
      // comparing two storms needs both of them open.
      name: `events-group-${index + 1}`,
      type: first.type,
      typeTitle: first.typeTitle,
      segregationRef: first.segregationRef,
      status: first.status,
      statusLabel: first.statusLabel,
      statusRole: first.statusRole,
      statusRetrying: first.statusRetrying,
      isDeadLetter: first.isDeadLetter,
      routeFrom: first.routeFrom,
      routeTo: first.routeTo,
      routeToIsTopic: first.routeToIsTopic,
      routeToTitle: first.routeToTitle,
      routeDetail: first.routeDetail,
      routeDetailShort: first.routeDetailShort,
      createdAt: created.text,
      createdAtTitle: created.title,
      attempts,
      attemptsAtMax,
      showAttempts: showsAttempts(highest, hasFailure),
      hasFailure,
      lastFailureAt: failed.text,
      failureTitle: toFailureTitle(
        attempts,
        showsAttempts(highest, hasFailure),
        hasFailure ? failed.title : noTimestamp.title
      )
    }
  }

/**
 * The four states an operator triages by, in the order they would want to hear
 * them: what is dead, what is fighting, what is moving, what is done. A status
 * the endpoint invents belongs to none of them and is counted in none — the
 * strip says what it can stand behind, and the rows below say the rest.
 */
const rollupBuckets: { label: string; statuses: string[] }[] = [
  { label: 'dead-lettered', statuses: ['DEAD_LETTER'] },
  { label: 'retrying', statuses: ['FAILED', 'RESUBMITTED'] },
  { label: 'in flight', statuses: ['PUBLISHED', 'PROCESSING'] },
  { label: 'completed', statuses: ['COMPLETED'] }
]

/**
 * The strip above the table, counted from the rows on screen and from nothing
 * else. No total for the stream exists — the endpoint pages by keyset and
 * never reports one — so every number here is qualified by "on this page" and
 * an empty bucket is simply not mentioned rather than printed as a zero.
 */
const toFilledBuckets = (events: Event[]): RollupBucket[] =>
  rollupBuckets
    .map(({ label, statuses }) => ({
      label,
      count: events.filter((event) => statuses.includes(event.status)).length,
      deadLettered: label === 'dead-lettered'
    }))
    .filter(({ count }) => count > 0)

/** Nothing to age: an empty page, or one whose every date was unreadable. */
const noOldest: { text: string | null; title: string } = {
  text: null,
  title: ''
}

const toOldest = (events: Event[], now: Date) => {
  const times = toTimes(events.map((event) => event.createdAt))

  return times.length === 0 ? noOldest : toStamp(Math.min(...times), now)
}

const toRollup = (events: Event[], now: Date): EventsRollup => {
  const { text, title } = toOldest(events, now)

  return {
    buckets: toFilledBuckets(events),
    oldest: text,
    oldestTitle: title
  }
}

/**
 * Which sources are missing, in the vocabulary the alert already uses. Any
 * source can fail, GAS included, so the alert names what is actually gone
 * rather than assuming Caseworking.
 */
const toUnavailableSources = (sourceErrors: SourceError[] = []): string =>
  sourceErrors.map(toSourceName).join(', ')

/**
 * The statuses the filter bar offers, in the order a message travels through
 * them. The endpoint may still pass a status through that is not on this list —
 * a `?status=` typed by hand, say — in which case no chip is active, including
 * All, which is the honest answer: the page is filtered to none of these.
 */
const statusFilters: string[] = [
  'PUBLISHED',
  'PROCESSING',
  'FAILED',
  'RESUBMITTED',
  'COMPLETED',
  'DEAD_LETTER'
]

const serviceFilters = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * A filter link carries the *other* filter and nothing else. `cursor` and
 * `direction` are deliberately dropped: a keyset position taken in one filter
 * means nothing in another, so changing a filter starts the list again.
 */
const toFilterHref = ({ status, service }: EventsQuery): string => {
  const params = new URLSearchParams()

  if (status) {
    params.set('status', status)
  }
  if (service) {
    params.set('service', service)
  }

  return params.size ? `/dev-ops/events?${params}` : '/dev-ops/events'
}

const toStatusChips = ({ status, service }: EventsQuery): FilterChip[] => [
  { label: 'All', href: toFilterHref({ service }), active: !status },
  ...statusFilters.map((value) => ({
    label: toStatusLabel(value),
    href: toFilterHref({ status: value, service }),
    active: status === value
  }))
]

const toServiceChips = ({ status, service }: EventsQuery): FilterChip[] => [
  { label: 'All', href: toFilterHref({ status }), active: !service },
  ...serviceFilters.map(({ value, label }) => ({
    label,
    href: toFilterHref({ status, service: value }),
    active: service === value
  }))
]

/**
 * A page keeps the filter it was opened with. The cursor is only a keyset
 * position, so `status` and `service` have to be carried on the link or the
 * next page quietly widens to All.
 */
const toHref = (
  cursor: string | null,
  direction: 'forward' | 'backward',
  { status, service }: EventsQuery
): string | null => {
  if (!cursor) {
    return null
  }

  const params = new URLSearchParams({ cursor, direction })

  if (status) {
    params.set('status', status)
  }
  if (service) {
    params.set('service', service)
  }

  return `/dev-ops/events?${params}`
}

/**
 * @param now Injected so the relative times a test asserts on are the times it
 *   set up; the page itself renders against the clock at request time.
 */
export const toEventsPage = (
  { page, unavailable }: EventsResult,
  query: EventsQuery,
  now: Date = new Date()
): EventsPageModel => {
  const { events, pagination, sourceErrors } = page
  const groups = toRuns(events).map(toGroup(now))

  return {
    // Flat as well as grouped: the pager and the rollup count rows, not
    // groups, and folding a retry storm must never change either number.
    rows: groups.flatMap((group) => group.rows),
    groups,
    groupCount: groups.filter((group) => group.grouped).length,
    eventCount: events.length,
    rollup: toRollup(events, now),
    statusFilters: toStatusChips(query),
    serviceFilters: toServiceChips(query),
    previousHref: pagination.hasPreviousPage
      ? toHref(pagination.startCursor, 'backward', query)
      : null,
    nextHref: pagination.hasNextPage
      ? toHref(pagination.endCursor, 'forward', query)
      : null,
    unavailableSources: toUnavailableSources(sourceErrors),
    unavailable
  }
}
