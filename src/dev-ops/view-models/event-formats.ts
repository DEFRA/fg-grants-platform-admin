import { config } from '../../common/config.ts'
import type { Event } from '../repositories/events.repository.ts'

/**
 * The vocabulary the events list and the single-event page share.
 *
 * Two pages about the same rows have to say the same things the same way: a
 * status is a dot and a word here and there, a route reads `GAS → Caseworking`
 * on both, and an instant is spelled `2026-06-16T10:00:00Z` wherever it is
 * quoted. Each of these lived in events-page.view-model.ts while there was one
 * page; a second page that re-derived any of them would drift from the first
 * the first time either changed.
 *
 * What stays out of here is anything one page shapes for itself — how far a
 * value is truncated, what a tooltip stacks — because those are decisions
 * about a column's width, not about what the value means.
 */

/**
 * The status roles these pages use, named by meaning rather than by class. Each
 * one is a colour of dot and a weight of label; the literal classes live in
 * status-badge/template.njk, because Tailwind scans views/ for candidates and a
 * class name spelled only in TypeScript is purged from the stylesheet without a
 * word of warning.
 */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

export const serviceLabels: Record<string, string> = {
  gas: 'GAS',
  caseworking: 'CW'
}

export const boxLabels: Record<string, string> = {
  inbox: 'Inbox',
  outbox: 'Outbox'
}

/**
 * The Route cell reads in full names — the short codes belong to the topic
 * strings on the line beneath it, not to the sentence a human reads first.
 * `?` is the placeholder for a hop the row does not name.
 */
const fullNames: Record<string, string> = {
  GAS: 'GAS',
  CW: 'Caseworking',
  AS: 'Agreements',
  PAY: 'Payments',
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

export const toStatusBadge = (status: string) =>
  statusBadges[status] ?? unknownStatus

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

export const toStatusLabel = (status: string): string =>
  statusLabels[status] ?? status

/**
 * What each status actually means, in one line, for the `title` of the chip
 * that counts it.
 *
 * Six words on a strip cannot say what six states are, and the wire's
 * spelling does not help: `Failed` and `Dead letter` read as two words for one
 * thing, `Resubmitted` and `Published` as two more, and an operator new to the
 * page has no way to tell which of them is a thing they should be doing
 * something about. The distinction that matters is whether the poller is still
 * trying, and every line below is written to answer that first.
 *
 * A status the endpoint invents has no explainer, and its chip carries none —
 * an invented sentence about an unknown state would be a worse answer than
 * silence.
 */
const statusExplainers: Record<string, string> = {
  PUBLISHED: 'Queued, not yet claimed',
  PROCESSING: 'Claimed, in flight',
  FAILED: 'Awaiting automatic retry',
  RESUBMITTED: 'Queued for another retry cycle',
  COMPLETED: 'Processed successfully',
  DEAD_LETTER: 'Failed all retry attempts; needs a redrive'
}

export const toStatusExplainer = (status: string): string | null =>
  statusExplainers[status] ?? null

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

/** The wall clock alone, in UTC: `10:16:05`. */
const utcClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

/**
 * The same clock with the day in front of it, for an instant that is no longer
 * today: `1 Sep 08:18`.
 *
 * Assembled from parts rather than formatted whole, for two reasons. The order
 * is day-first, which `en-US` does not write; and the three-letter month is
 * `en-US`'s, because `en-GB` spells September `Sept` and a column of months
 * that is three characters wide except in one month is a column that jumps.
 *
 * Seconds go when the date arrives. A row from four days ago is placed by its
 * day, not by the second within a minute it happened — and the whole instant,
 * seconds and all, is one hover and one copy button away.
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
const hoursPerDay = 24
const msPerDay = msPerSecond * secondsPerMinute * minutesPerHour * hoursPerDay

/**
 * How long ago, in the coarsest unit that still says something useful. Under a
 * minute counts seconds, under an hour counts minutes, under a day carries the
 * spare minutes, and past that a day count is all anyone reads.
 */
export const toRelative = (from: Date, now: Date): string => {
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

/** The same instant as the operator's own wall clock reads it. */
export const toLondon = (value: string): string | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? null
    : `${londonTimestamp.format(date)} (Europe/London)`
}

/** The instant whole, milliseconds and all: what a copy button carries. */
export const toIso = (value: string): string | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The second line of a Created cell: the time of day, and the date as well
 * once the row is more than a day old.
 *
 * One keyset window is almost always one day, so the date is not worth a
 * column — but "almost always" is where this line used to lie. `08:18:01` on a
 * row from last Tuesday is read as this morning by anybody scanning, and a
 * page filtered to Dead letter is exactly the page whose rows are old. Past
 * twenty-four hours the day arrives and the seconds go: a row that old is
 * placed by its date, and the second it happened in is on the title and on the
 * clipboard.
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
 * Relative on the page, absolute in the tooltip. The title carries both the
 * ISO instant a developer pastes into a log query and the Europe/London
 * wall-clock time the operator is thinking in, because a relative time alone
 * is unquotable and a stale tab makes it a lie.
 */
export const toTimestamp = (value: string, now: Date): Timestamp => {
  const date = new Date(value)

  // Intl throws on an unparseable date; a dash is more use than a 500.
  if (Number.isNaN(date.getTime())) {
    return { text: '-', title: '' }
  }

  return {
    text: toRelative(date, now),
    title: `${toAbsolute(value)}   ·   ${toLondon(value)}`
  }
}

/** `GAS · Inbox` — the half of the label the alert and the table share. */
export const toSourceName = ({
  service,
  box
}: {
  service: string
  box: string
}) => `${serviceLabels[service] ?? service} · ${boxLabels[box] ?? box}`

/**
 * The half of a topic name that says nothing the row has not already said:
 * `cw__sns__`, `gas__sqs__` — the *publisher* and the transport, both of which
 * the hop label above it has already named. What is left is the part that
 * tells one queue from another: `audit_topic_arn`, `create_new_case_fifo.fifo`.
 * The raw string, prefix and all, stays on the `title` and on the clipboard.
 */
const topicPrefix = /^[^\s]*?__(?:sns|sqs)__/

const toBareTopic = (topic: string): string => topic.replace(topicPrefix, '')

/**
 * One topic, one key, whatever spelling it arrived in.
 *
 * The same destination is written three ways across the estate: with a
 * publisher prefix and a FIFO suffix (`gas__sns__create_new_case_fifo.fifo`),
 * with neither (`create_payment.fifo`), and with the `_fifo` baked into the
 * name but no `.fifo` after it (`cw__sns__audit_fifo`). Taking all three off
 * leaves the only part that says what the message is, which is the part the
 * consumer map is keyed on.
 */
const toNormalisedTopic = (topic: string): string =>
  toBareTopic(topic)
    .replace(/\.fifo$/, '')
    .replace(/_fifo$/, '')

/**
 * Who actually reads each topic.
 *
 * This column used to read the destination off the topic's own prefix, which
 * is wrong in the most misleading way available: the platform's topics are
 * named for their *publisher*. `gas__sns__create_new_case_fifo.fifo` is GAS's
 * topic, consumed by Caseworking — and the prefix rule printed it as
 * `GAS → GAS`, turning every hop the page exists to show into a self-route.
 *
 * A name cannot be asked who subscribes to it, so the subscriptions are
 * written down here, one entry per topic, each with the file that declares it.
 * Keyed by the normalised name, so every spelling of a topic finds one entry.
 */
const topicConsumers: Record<string, string> = {
  // floci 10-core-resources.sh:170 subscribes cw__sqs__create_new_case_fifo
  // .fifo, which fg-cw-backend config.js:153 reads case commands from.
  create_new_case: 'CW',
  // floci 10-core-resources.sh:171 subscribes cw__sqs__update_status_fifo
  // .fifo, fg-cw-backend config.js:160.
  update_case_status: 'CW',
  // floci 10-core-resources.sh:165 subscribes gas__sqs__update_status_fifo
  // .fifo, fg-gas-backend config.js:154.
  case_status_updated: 'GAS',
  // floci 10-core-resources.sh:166 and :188 subscribe two agreements queues;
  // neither is a GAS or a Caseworking queue.
  update_agreement_status: 'AS',
  // floci 10-core-resources.sh:167 subscribes gas__sqs__update_agreement_
  // status_fifo.fifo, fg-gas-backend config.js:155.
  agreement_status_updated: 'GAS',
  // floci 10-core-resources.sh:172 subscribes create_agreement_fifo.fifo, an
  // agreements-api queue.
  create_agreement: 'AS',
  // floci 10-core-resources.sh:189 subscribes gps__sqs__create_payment.fifo,
  // the grants payment service.
  create_payment: 'PAY',
  // Every service publishes its own audit topic — floci 10-core-resources.sh
  // :178 and :179 — and they all feed the audit stream, not a service.
  audit: 'AUDIT',
  audit_topic_arn: 'AUDIT'
}

/**
 * Where a topic's messages land. A topic with no subscription we can point at
 * in the platform's own configuration — `grant_application_created`,
 * `application_status_updated`, `case_created`, and anything the estate adds
 * next — is named as the endpoint wrote it rather than flattened to "unknown",
 * which would hide the one string a developer would want to grep for.
 */
const toNamedTarget = (target: string): string =>
  topicConsumers[toNormalisedTopic(target)] ?? target

/** `internal` never leaves the service that wrote it; no target at all is `?`. */
const toDestination = (target: string | null, own: string): string => {
  if (!target) {
    return '?'
  }

  return target === 'internal' ? own : toNamedTarget(target)
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
  routeDetail: `${own.toLowerCase()} ${box}`
})

/**
 * An outbox row is owned by the service that wrote it and points at a topic.
 * Line two is the topic alone: the arrow above already says it left, so the
 * word `outbox` was only taking room from the string worth reading.
 *
 * When no subscription in the platform's config names a consumer for the
 * topic there is no service on the far end of the arrow to name, and a route that reads `GAS → …` is a
 * sentence with its object cut off. The topic is then the destination: it goes
 * on the arrow, stripped of its transport prefix and set in mono because it is
 * a machine string, and the `(via …)` suffix — which would say the same thing
 * a second time — is dropped. The raw topic is on the title.
 */
/** A destination no subscription could name is the topic itself. */
const isTopicDestination = (target: string | null, destination: string) =>
  target !== null && destination === target

/** The topic on the arrow, and no suffix behind it to say it twice. */
const toTopicRoute = (target: string, own: string) => ({
  routeFrom: toFullName(own),
  routeTo: toBareTopic(target),
  routeToIsTopic: true,
  routeToTitle: target,
  routeDetail: `via ${target}`
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
  routeDetail: `via ${target ?? '-'}`
})

const toOutboxRoute = (target: string | null, own: string) => {
  const destination = toDestination(target, own)

  return isTopicDestination(target, destination)
    ? toTopicRoute(target as string, own)
    : toNamedRoute(target, own, destination)
}

/** The names and the suffix of the Route cell's one line. */
export const toRoute = ({ service, box, source, target }: Event) => {
  const own = serviceLabels[service] ?? service

  return box === 'outbox'
    ? toOutboxRoute(target, own)
    : toInboxRoute(source, own, box)
}

/**
 * The list's Queue cell: which hop a row is, and what it travelled on.
 *
 * `toRoute` above says `GAS → Caseworking (via …)`, and the single-event page
 * is where that sentence belongs — it is one row, read once, with room for a
 * whole producer → consumer fact. In a list of twenty it was the widest
 * column on the page carrying the one thing an operator re-derives least
 * often, and it left out the two things they actually want from a row:
 *
 * *Which hop is this?* An outbox write and the inbox consume that answers it
 * share an event id, so a search for that id returns both, and nothing else on
 * either row tells them apart. `GAS · Outbox` is spelled by `toSourceName`,
 * the same call the journey table makes, so the list and the page a row opens
 * cannot drift into two vocabularies for one fact.
 *
 * *Which queue?* The transport's own name, whole and copyable, because that is
 * the string that gets pasted into an AWS console or a log query. It is never
 * cut to a character count here — the column truncates with an ellipsis when
 * it is narrow, and the raw target is a hover and a click away.
 */
export interface QueueCell {
  /** `GAS · Outbox`, `CW · Inbox` — the hop, as the journey table says it. */
  hop: string
  /**
   * The line under it, and a hop either way round: `to Caseworking` on an
   * outbox row, `from Agreements` on an inbox one. Both name the service at
   * the other end, resolved through the same subscription map the detail
   * page's Route uses, so the two cannot drift. Null when an outbox row names
   * no target at all.
   */
  queue: string | null
  /**
   * The target exactly as it is stored, whole ARN and all: what the line hangs
   * off its `title`, and the whole of how it stays reachable now that the line
   * itself shows a destination name. Null on an inbox row, whose line names a
   * producer rather than a transport.
   */
  queueValue: string | null
}

/**
 * Where an outbox row's message is going, in the words the detail page's Route
 * uses for the same fact.
 *
 * Deliberately built on `toDestination` and `isTopicDestination` — the same two
 * the Route is — rather than on a second copy of the subscription map. A list
 * row and the page it opens saying different things about one hop is the bug
 * this shares them to avoid.
 *
 * A topic no subscription names has no service to name, so it names itself: the
 * normalised topic, which is the very key the map was searched under, rather
 * than the raw `gas__sns__…_fifo.fifo` token that only repeats the hop above.
 */
const toOutboxDestination = (target: string, own: string): string => {
  const destination = toDestination(target, own)

  return isTopicDestination(target, destination)
    ? toNormalisedTopic(target)
    : toFullName(destination)
}

/**
 * An outbox row's line two: where the message went. `to Caseworking` reads as
 * the other half of the inbox row's `from GAS`, so a column of both directions
 * reads as one vocabulary of hops rather than as a sentence beside a machine
 * string. The raw topic is still on the title and on the clipboard.
 */
const toOutboxQueue = (target: string | null, own: string) => ({
  queue: target === null ? null : `to ${toOutboxDestination(target, own)}`,
  queueValue: target
})

/** An inbox row's: who produced the message that is sitting in the box. */
const toInboxQueue = (source: string | null) => ({
  queue: `from ${toFullName(source ?? '?')}`,
  queueValue: null
})

export const toQueue = ({
  service,
  box,
  source,
  target
}: Event): QueueCell => ({
  hop: toSourceName({ service, box }),
  ...(box === 'outbox'
    ? toOutboxQueue(target, serviceLabels[service] ?? service)
    : toInboxQueue(source))
})

// Both counts are nullable on the wire, so neither is assumed.
// Defensive: the contract says both are always integers, but a wrong answer here is silent.
export const toAttempts = (
  attempts?: number | null,
  maxAttempts?: number | null
) => (attempts == null ? '-' : `${attempts}/${maxAttempts ?? '?'}`)

export const isAtMaxAttempts = (
  attempts?: number | null,
  maxAttempts?: number | null
) => attempts != null && maxAttempts != null && attempts >= maxAttempts

/**
 * The pair-finding link: this value, and no other filter at all. Used for the
 * REFERENCE, which really does gather a set — an event id does not, so it
 * carries no such link: Mongo's unique constraint means `?q=<id>` could only
 * ever answer with the one row the operator was already looking at.
 *
 * Dropping `status` and `service` is the whole point of it. An
 * operator clicking an id is asking "where else did this message go?", and
 * they are almost always asking it from a page filtered to Dead letter — the
 * one filter guaranteed to hide the earlier, healthy hops they are looking
 * for. A link that kept the filter would answer the question with the one row
 * they already had.
 */
export const toSearchHref = (value: string): string =>
  `/dev-ops/events?q=${encodeURIComponent(value)}`

/**
 * The whole value, then what clicking it does. The value stays on the first
 * line because it is the string an operator reads and copies; the sentence
 * under it is there because a token that suddenly navigates has to say so
 * before it is clicked.
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
 *
 * The kuery arrives already built, because there are two of them now and only
 * the query differs: one asks for a trace id, the other for an event id
 * anywhere in a log line. Everything else — the columns, the index pattern,
 * the window — is what makes both of them the same link.
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
 * Two things have to be in place before a row is worth linking: a deployment
 * that names a logs explorer, and an event that actually carries a trace. The
 * link is the same shape for every service — cross-service by design, so the
 * whole journey of a trace is one click.
 */
export const toTraceHref = (event: {
  traceId: string | null
  createdAt: string
}): string | null => {
  const base = config.get('logs.explorerBaseUrl') as string

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
 * How long an event took, from published to completed, in the coarsest unit
 * that still says something: milliseconds under a second, a tenth of a second
 * under a minute, and minutes and seconds past that.
 *
 * Only ever drawn where both instants exist. A completion the endpoint did not
 * record is not a latency of zero, and a row that has not completed has no
 * duration to report at all.
 */
export const toLatency = (
  createdAt: string,
  completedAt: string | null
): string | null => {
  if (!completedAt) {
    return null
  }

  const started = new Date(createdAt).getTime()
  const finished = new Date(completedAt).getTime()

  // A date the endpoint wrote that we cannot read leaves no duration to
  // report, and `NaNms` is worse than saying nothing.
  return Number.isNaN(started) || Number.isNaN(finished)
    ? null
    : toDuration(Math.max(0, finished - started))
}

/**
 * The four spellings a duration takes, in the order they run out.
 *
 * Past an hour it reads `5h 34m` rather than `334m 0s`: a gap between two
 * delivery attempts is read to see the shape of a backoff, and a figure in
 * minutes with a trailing `0s` is a number to be divided rather than a
 * duration to be recognised.
 */
export const toDuration = (ms: number): string => {
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

/**
 * The gap between two instants, or nothing at all when either will not parse.
 *
 * It is what makes a backoff visible: four attempts at `+273ms`, `+512ms`,
 * `+1.1s` is a service retrying into a wall, and four at `+30s`, `+2m 0s`,
 * `+8m 0s` is one waiting properly. Neither fact is in a list of timestamps
 * until something subtracts them.
 */
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
export const toEventHref = ({
  service,
  box,
  id
}: {
  service: string
  box: string
  id: string
}): string =>
  `/dev-ops/events/${encodeURIComponent(service)}/${encodeURIComponent(box)}/${encodeURIComponent(id)}`
