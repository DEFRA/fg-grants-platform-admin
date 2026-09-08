import type {
  EventDetail,
  EventKey,
  EventResult,
  JourneyHop as JourneyHopResponse
} from '../use-cases/get-event.use-case.ts'
import type { BadgeRole } from './event-formats.ts'
import {
  none,
  noTimestamp,
  toAbsolute,
  toEventHref,
  toGap,
  toIso,
  toSearchHref,
  toSearchTitle,
  toTimestamp,
  toTraceHref
} from './event-formats.ts'

/**
 * The page for one event. Unlike the list, nothing is cut to a column width:
 * an operator opens this page to paste something out of it, so every value is
 * shown whole.
 */

export { none }

/** One hop on the journey table: a row somewhere with the same event id. */
interface JourneyHop {
  /** `GAS Outbox` — which queue this hop is, in the alert's vocabulary. */
  source: string
  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  createdAt: string
  createdAtTitle: string
  /**
   * How long this hop took, created to completed: `430ms`, `1.2s`. `—` on a
   * hop that has not completed — a zero there would read as an instant one.
   */
  took: string
  /** This hop's own page, carrying the same `from` as the page it is on. */
  href: string
  /** The hop the operator is already looking at. See toJourney. */
  isCurrent: boolean
}

/** One delivery attempt, as the timeline draws it. */
interface AttemptEntry {
  /** `#1`, oldest first. */
  number: string
  /** The instant, whole, milliseconds and all. See toAttemptHistory. */
  absolute: string
  /**
   * The gap since the attempt before this one — `+273ms`, `+5h 34m` — or, on
   * the first, since the event was created: `after 273ms`. Null only when an
   * instant will not parse.
   */
  delta: string | null
  name: string
  message: string
  /**
   * The stack, whole, revealed by expanding the row. Null where the attempt
   * has none, and the template draws no expander for those: an expander that
   * opens onto nothing is worse than no expander.
   */
  stack: string | null
  /** Both spellings of the instant, for anyone hovering the line. */
  title: string
}

interface EventBanner {
  role: 'success' | 'warning' | 'error'
  message: string
}

export interface EventPageModel {
  /** The event could not be read at all — the page is a shell and an alert. */
  unavailable: boolean
  /** The list, as the operator left it. */
  backHref: string
  /** The same query, to put on this page's own links and in the redrive form. */
  from: string
  banner: EventBanner | null

  /**
   * Always there: a record that is not a CloudEvent is labelled `audit` by
   * fg-gas-backend, and the sentence explaining that arrives as `typeTitle`.
   */
  type: string
  /** The endpoint's own spelling, on the type's `title`, when the two differ. */
  typeTitle: string | null
  eventId: string

  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  isDeadLetter: boolean
  /** `3/5`, or `-` when the endpoint reported no count. */
  attempts: string
  showAttempts: boolean
  hasFailure: boolean
  lastFailureAt: string
  failureTitle: string

  /** The list's Queue cell exactly, so the two surfaces read alike. */
  hop: string
  queue: string | null
  queueValue: string | null
  segregationRef: string | null
  segregationRefHref: string | null
  segregationRefTitle: string | null
  traceparent: string | null
  traceId: string | null
  traceHref: string | null

  /**
   * An inbox row is a message this service received; an outbox row is one it
   * is publishing. The two have genuinely different lifecycles, so the facts
   * list draws a different set for each.
   */
  isInbox: boolean
  /** The instant absolutely: the ISO UTC spelling a log query takes. */
  createdAtAbsolute: string
  /**
   * On a GAS document the row's order key IS one of the lifecycle instants
   * below it (`eventTime` on inbox, `publicationDate` on outbox); printing it
   * twice under two labels would be one instant claiming to be two facts, so
   * the lifecycle label wins and this row is left out. On a Caseworking
   * document the two differ and both are drawn.
   */
  showCreated: boolean
  /**
   * When the producer says the event happened — the CloudEvent's `time`.
   * Inbox only; `occurredKnown` says whether to draw the row at all.
   */
  occurred: string
  occurredKnown: boolean
  /**
   * The FIFO message group the event was published in. Outbox only, and null
   * on a document that has none — an audit record, or a topic that is not
   * FIFO — which is a row the list leaves out.
   */
  messageGroup: string | null

  /** Absolute UTC, or `—`: the four dates the poller writes as it works. */
  publicationDate: string
  /** Only on a row that has finished. See toDates. */
  completedDate: string
  lastResubmissionDate: string
  claimedAt: string
  claimExpiresAt: string

  /** The failure in full — class, whole message, when. Null with no failure. */
  errorName: string | null
  errorMessage: string | null
  errorAt: string | null

  /**
   * Every attempt the endpoint has a record of, oldest first. Empty on an
   * event written before the history was kept, which the page says in words:
   * an empty section reads as "it never failed", the opposite of what an
   * empty history means on a dead letter.
   */
  attemptHistory: AttemptEntry[]
  /**
   * Where the timeline ends: `dead-lettered`, or `completed at <instant>`.
   * Null while the event is still in play.
   */
  attemptOutcome: string | null

  /** The stored event, pretty-printed. Null when there is nothing stored. */
  payloadJson: string | null

  journey: JourneyHop[]

  /** Dead-lettered, and therefore worth offering to put back on the queue. */
  canRedrive: boolean
  /** The operator asked for the confirmation, and it is theirs to confirm. */
  confirmRedrive: boolean
  redriveHref: string
  cancelHref: string
  /** Where the confirmation posts: the endpoint's own path, on this app. */
  redriveAction: string

  /**
   * The last redrive, in the two registers the card draws every composite
   * value in: the absolute UTC instant as the value, the person who asked as
   * the muted suffix beside it. Both null when nobody has redriven this
   * event, or when it was redriven before the backend recorded who did.
   */
  lastRedriveAt: string | null
  lastRedriveBy: string | null
  /**
   * The sentence above the buttons on an event whose last redrive achieved
   * nothing. Null unless every part of that is true — see `toFutileWarning`.
   */
  futileWarning: string | null
  /**
   * Every other dead letter that failed the same way. Null on an event with
   * no error recorded, and on one that is not a dead letter.
   */
  errorSearchHref: string | null
}

/**
 * The back link's suffix, and the only untrusted string this page puts in an
 * href. It arrives as an opaque query string the list handed out, only ever
 * appended to `/dev-ops/events` — so the two things that could turn that into
 * a link somewhere else are the two things checked here: a value that does not
 * open with `?` is not a query string at all, and a value containing `//` is
 * how a path plus a suffix becomes a protocol-relative url pointing at another
 * host. Anything failing either test is dropped rather than repaired.
 */
export const toSafeFrom = (from: string | undefined | null): string =>
  typeof from === 'string' && from.startsWith('?') && !from.includes('//')
    ? from
    : ''

const toBackHref = (from: string): string => `/dev-ops/events${from}`

const toSelfHref = (
  key: EventKey,
  from: string,
  extra?: [string, string]
): string => {
  const params = new URLSearchParams()

  if (from !== '') {
    params.set('from', from)
  }

  if (extra) {
    params.set(extra[0], extra[1])
  }

  return params.size ? `${toEventHref(key)}?${params}` : toEventHref(key)
}

const toAbsoluteOrNone = (value: string | null): string =>
  value === null ? none : (toAbsolute(value) ?? none)

const toIsoOrEmpty = (value: string): string => toIso(value) ?? ''

/**
 * Both facts are read out of the stored payload by fg-gas-backend and arrive
 * as fields, so this page renders them rather than going looking inside a
 * document it treats as opaque everywhere else. Null is "this document does
 * not carry it" — a row the facts list leaves out rather than draws as a dash.
 */
const toPayloadFacts = (event: EventDetail, isInbox: boolean) => ({
  occurred: isInbox ? toAbsoluteOrNone(event.occurredAt) : none,
  occurredKnown: isInbox && event.occurredAt !== null,
  messageGroup: isInbox ? null : event.messageGroupId
})

/**
 * Rendered as text and nothing else: nunjucks escapes it on the way into the
 * `<pre>`, so a payload containing markup is readable rather than a script
 * this page runs. `undefined` is the one shape with nothing to print — a
 * stored `null` is a real payload and says so.
 */
const toPayloadJson = (payload: unknown): string | null =>
  payload === undefined ? null : JSON.stringify(payload, null, 2)

/**
 * Every row the list endpoint holds under this event id, in the order it
 * returned them. The current hop is marked rather than unlinked: a row
 * without a link reads as a row that is broken.
 */
const toJourney = (
  events: JourneyHopResponse[],
  key: EventKey,
  from: string
): JourneyHop[] =>
  events.map((hop) => {
    return {
      source: hop.hop,
      status: hop.status,
      statusLabel: hop.statusLabel,
      statusRole: hop.statusRole,
      statusRetrying: hop.statusRetrying,
      // Both measured by the owning box's own clock, which is why they arrive
      // rather than being reconstructed here from two instants.
      createdAt: toAbsoluteOrNone(hop.startedAt),
      createdAtTitle: toIsoOrEmpty(hop.startedAt),
      took: hop.took ?? none,
      href: toSelfHref(hop, from),
      isCurrent:
        hop.service === key.service && hop.box === key.box && hop.id === key.id
    }
  })

/**
 * A write that redirects has to carry its own result, because the page that
 * lands is a fresh read that knows nothing about the click that caused it.
 * The conflict banner deliberately names the state the event is actually in:
 * nothing went wrong, the event simply moved on.
 */
const banners: {
  reads: (query: EventPageQuery) => string | undefined
  toBanner: (value: string) => EventBanner
}[] = [
  {
    reads: (query) => query.redriven,
    toBanner: () => ({
      role: 'success',
      message:
        'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
    })
  },
  {
    reads: (query) => query.redrive_conflict,
    toBanner: (status) => ({
      role: 'warning',
      message: `Not redriven — this event is no longer dead-lettered. Its status is now ${status}.`
    })
  },
  {
    reads: (query) =>
      query.redrive_error === 'missing' ? query.redrive_error : undefined,
    toBanner: () => ({
      role: 'error',
      message:
        'Not redriven — fg-gas-backend no longer has this event. Nothing has changed.'
    })
  },
  {
    reads: (query) => query.redrive_error,
    toBanner: () => ({
      role: 'error',
      message:
        'Not redriven — fg-gas-backend could not be reached. Nothing has changed.'
    })
  }
]

const toBanner = (query: EventPageQuery): EventBanner | null => {
  for (const banner of banners) {
    const value = banner.reads(query)

    if (value !== undefined) {
      return banner.toBanner(value)
    }
  }

  return null
}

export interface EventPageQuery {
  from?: string
  confirm?: string
  redriven?: string
  redrive_conflict?: string
  redrive_error?: string
}

/** Everything the page can say without an event. */
const toShell = (key: EventKey, query: EventPageQuery) => {
  const from = toSafeFrom(query.from)

  return {
    from,
    backHref: toBackHref(from),
    banner: toBanner(query),
    redriveAction: `${toEventHref(key)}/redrive`
  }
}

const emptyDetail = {
  type: '',
  typeTitle: null,
  eventId: '',
  status: '',
  statusLabel: '',
  statusRole: 'neutral' as BadgeRole,
  statusRetrying: false,
  isDeadLetter: false,
  attempts: '-',
  showAttempts: false,
  hasFailure: false,
  lastFailureAt: none,
  failureTitle: '',
  hop: '',
  queue: null,
  queueValue: null,
  segregationRef: null,
  segregationRefHref: null,
  segregationRefTitle: null,
  traceparent: null,
  traceId: null,
  traceHref: null,
  isInbox: true,
  createdAtAbsolute: none,
  showCreated: true,
  occurred: none,
  occurredKnown: false,
  messageGroup: null,
  publicationDate: none,
  completedDate: none,
  lastResubmissionDate: none,
  claimedAt: none,
  claimExpiresAt: none,
  errorName: null,
  errorMessage: null,
  errorAt: null,
  attemptHistory: [] as AttemptEntry[],
  attemptOutcome: null as string | null,
  payloadJson: null,
  journey: [] as JourneyHop[],
  canRedrive: false,
  confirmRedrive: false,
  redriveHref: '',
  cancelHref: '',
  lastRedriveAt: null as string | null,
  lastRedriveBy: null as string | null,
  futileWarning: null as string | null,
  errorSearchHref: null as string | null
}

/**
 * The words are the endpoint's — the same ones the list draws. The instant is
 * stated absolutely rather than relatively, because there is no column to fit
 * and a relative time cannot be pasted into a log query.
 */
const toState = (event: EventDetail) => {
  const failedAt =
    event.lastFailureAt === null ? null : toAbsolute(event.lastFailureAt)
  const hasFailure = failedAt !== null

  return {
    status: event.status,
    statusLabel: event.statusLabel,
    statusRole: event.statusRole,
    statusRetrying: event.statusRetrying,
    isDeadLetter: event.status === 'DEAD_LETTER',
    attempts: event.attempts,
    showAttempts: event.showAttempts,
    hasFailure,
    lastFailureAt: failedAt ?? none,
    failureTitle: failedAt ?? noTimestamp.title
  }
}

const toReference = (segregationRef: string | null) =>
  segregationRef === null
    ? {
        segregationRef,
        segregationRefHref: null,
        segregationRefTitle: null
      }
    : {
        segregationRef,
        segregationRefHref: toSearchHref(segregationRef),
        segregationRefTitle: toSearchTitle(segregationRef, 'reference')
      }

/**
 * When this box got the message. On an inbox row `createdAt` is the
 * CloudEvent's `time` — the producer's clock, stamped before the broker ever
 * saw it — so measuring an inbox hop from it books the whole transit leg to
 * this service. The outbox has no such gap: there `createdAt` IS the moment
 * the message was queued.
 */
const toReceivedAt = (
  event: { createdAt: string; publicationDate: string | null },
  isInbox: boolean
): string =>
  isInbox ? (event.publicationDate ?? event.createdAt) : event.createdAt

/**
 * `completedDate` asks a question of the status first: a redrive leaves the
 * old `completionDate` on the document, so a row that completed, was redriven
 * and then dead-lettered still carries the instant it completed at — and
 * drawing it said a dead letter had been published. The fact is a dash unless
 * the row is actually in the state the label names; the attempts timeline is
 * unaffected, since there a past completion is exactly the point.
 */
const toDates = (event: EventDetail) => ({
  createdAtAbsolute: toAbsoluteOrNone(event.createdAt),
  publicationDate: toAbsoluteOrNone(event.publicationDate),
  completedDate:
    event.status === 'COMPLETED'
      ? toAbsoluteOrNone(event.completionDate)
      : none,
  lastResubmissionDate: toAbsoluteOrNone(event.lastResubmissionDate),
  claimedAt: toAbsoluteOrNone(event.claimedAt),
  claimExpiresAt: toAbsoluteOrNone(event.claimExpiresAt)
})

const noFailure = { errorName: null, errorMessage: null, errorAt: null }

/** `at` alone can be missing, on an event that failed before it was recorded. */
const toFailure = (error: EventDetail['lastError']) =>
  error === null
    ? noFailure
    : {
        errorName: error.name,
        errorMessage: error.message,
        errorAt: error.at === null ? null : toAbsoluteOrNone(error.at)
      }

/**
 * The two gaps are labelled differently on purpose: `+273ms` reads down the
 * column as a backoff between attempts, while `after 273ms` on the first line
 * is a different measurement against a different instant — spelling both with
 * a `+` would invite reading them as one series.
 */
const toAttemptDelta = (
  previous: string | undefined,
  at: string,
  createdAt: string
): string | null => {
  if (previous === undefined) {
    const first = toGap(createdAt, at)

    return first === null ? null : `after ${first}`
  }

  const gap = toGap(previous, at)

  return gap === null ? null : `+${gap}`
}

/**
 * The endpoint caps the list at ten, so the numbers are positions in what was
 * kept, not in what happened — the honest thing to draw when the earliest of
 * forty are gone.
 *
 * Absolute, not relative, milliseconds and all: five attempts inside one
 * minute all round to `4h 24m ago`, and a retry storm's gaps are measured in
 * milliseconds — the instant plus the delta beside it is what makes a missing
 * backoff visible without anybody doing arithmetic.
 */
const toAttemptHistory = (
  attempts: EventDetail['attemptHistory'],
  createdAt: string,
  now: Date
): AttemptEntry[] =>
  (attempts ?? []).map((attempt, index, all) => ({
    number: `#${index + 1}`,
    absolute: toIso(attempt.at) ?? none,
    delta: toAttemptDelta(all[index - 1]?.at, attempt.at, createdAt),
    name: attempt.name,
    message: attempt.message,
    // Verbatim: a stack is not prose, and the backend already capped it.
    stack: attempt.stack,
    title: toTimestamp(attempt.at, now).title
  }))

/**
 * A list of five failures that stops without a word reads as an event still
 * failing; the outcome says which way it actually went.
 */
const toCompletedOutcome = (event: EventDetail): string | null => {
  const completed = event.completionDate

  return completed === null
    ? null
    : `completed at ${toAbsoluteOrNone(completed)}`
}

const attemptOutcomes: Record<string, (event: EventDetail) => string | null> = {
  DEAD_LETTER: () => 'dead-lettered',
  COMPLETED: toCompletedOutcome
}

const toAttemptOutcome = (event: EventDetail): string | null =>
  attemptOutcomes[event.status]?.(event) ?? null

/**
 * The confirmation is a url rather than a piece of script: `?confirm=redrive`
 * is the same page with a panel on it, which back-buttons and reloads like
 * every other state of it.
 */
const toRedrive = (
  isDeadLetter: boolean,
  key: EventKey,
  query: EventPageQuery,
  from: string
) => ({
  canRedrive: isDeadLetter,
  confirmRedrive: isDeadLetter && query.confirm === 'redrive',
  redriveHref: toSelfHref(key, from, ['confirm', 'redrive']),
  cancelHref: toSelfHref(key, from)
})

/**
 * The instant is stated absolutely — the UTC ISO spelling a log query takes —
 * because a relative time is unquotable and goes stale in an open tab.
 */
const toLastRedriveDetail = (lastRedrive: EventDetail['lastRedrive']) => {
  if (lastRedrive == null) {
    return { lastRedriveAt: null, lastRedriveBy: null }
  }

  return {
    lastRedriveAt: toAbsoluteOrNone(lastRedrive.at),
    lastRedriveBy: lastRedrive.by
  }
}

/**
 * Whether redriving again would only produce the same failure a third time.
 * Every part of the condition earns its place: a dead letter, because nothing
 * else can be redriven; two attempts or more, because one is not a pattern;
 * the last two messages identical, because a timeout then a duplicate key is
 * a system that changed its mind and worth another go; and a redrive on
 * record, because without one the identical failures are just the poller
 * doing its job. It is a note and not a block: the operator may know
 * something the page does not.
 */
const failedTheSameWayTwice = (
  history: EventDetail['attemptHistory']
): boolean => {
  const [previous, last] = history.slice(-2)

  return history.length >= 2 && previous.message === last.message
}

const isRepeatingItself = (event: EventDetail): boolean =>
  event.status === 'DEAD_LETTER' &&
  failedTheSameWayTwice(event.attemptHistory ?? [])

const toFutileWarning = (event: EventDetail): string | null => {
  const redrive = event.lastRedrive

  if (redrive == null || !isRepeatingItself(event)) {
    return null
  }

  return (
    `A previous redrive (by ${redrive.by}, ${toAbsoluteOrNone(redrive.at)}) failed with the identical error — ` +
    'redriving again is unlikely to succeed until the underlying cause is fixed.'
  )
}

/**
 * The whole message travels on `?error=`, unshortened — the endpoint matches
 * it exactly, and a truncated needle would quietly answer a wider question
 * than the one that was asked.
 */
const toErrorSearchHref = (event: EventDetail): string | null => {
  if (event.status !== 'DEAD_LETTER' || !event.lastError?.message) {
    return null
  }

  const params = new URLSearchParams({
    status: 'DEAD_LETTER',
    error: event.lastError.message
  })

  return `/dev-ops/events?${params}`
}

/**
 * The three facts only an inbox row can answer. The endpoint sends none of
 * them on an outbox row — something this service published has no reference
 * to segregate by and no trace of its own — so each is drawn as a dash there.
 */
const toInboxFacts = (event: EventDetail, receivedAt: string) => {
  const traceId = event.traceId ?? null

  return {
    ...toReference(event.segregationRef ?? null),
    traceparent: event.traceparent ?? null,
    traceId,
    // The log window opens around the moment this service saw the message,
    // not the moment the producer stamped it.
    traceHref: toTraceHref({ traceId, createdAt: receivedAt })
  }
}

const toDetail = (
  { event, journey }: FoundEvent,
  key: EventKey,
  query: EventPageQuery,
  from: string,
  now: Date
) => {
  const state = toState(event)
  const isInbox = key.box === 'inbox'
  const payload = toPayloadFacts(event, isInbox)
  const receivedAt = toReceivedAt(event, isInbox)

  return {
    type: event.type,
    typeTitle: event.typeTitle,
    eventId: event.eventId,
    ...state,
    hop: event.hop,
    queue: event.queue,
    queueValue: event.queueValue,
    ...toInboxFacts(event, receivedAt),
    ...toDates(event),
    ...payload,
    isInbox,
    showCreated:
      toAbsoluteOrNone(event.createdAt) !==
      (isInbox ? payload.occurred : toAbsoluteOrNone(event.publicationDate)),
    ...toFailure(event.lastError),
    attemptHistory: toAttemptHistory(event.attemptHistory, receivedAt, now),
    attemptOutcome: toAttemptOutcome(event),
    payloadJson: toPayloadJson(event.payload),
    journey: toJourney(journey, key, from),
    ...toRedrive(state.isDeadLetter, key, query, from),
    ...toLastRedriveDetail(event.lastRedrive),
    futileWarning: toFutileWarning(event),
    errorSearchHref: toErrorSearchHref(event)
  }
}

interface FoundEvent {
  event: EventDetail
  journey: JourneyHopResponse[]
}

/**
 * @param now Injected so the attempt tooltips a test asserts on are built
 *   against the clock it set up; the page itself renders at request time.
 */
export const toEventPage = (
  { outcome, event, journey }: EventResult,
  key: EventKey,
  query: EventPageQuery,
  now: Date
): EventPageModel => {
  const shell = toShell(key, query)

  if (outcome !== 'found' || event === null) {
    // The row's id comes from the address rather than from the event this
    // page could not read: a breadcrumb whose leaf is empty says nothing
    // about which page failed to load, and the address is the one fact a
    // failed read still has.
    return { unavailable: true, ...shell, ...emptyDetail, eventId: key.id }
  }

  return {
    unavailable: false,
    ...shell,
    ...toDetail({ event, journey }, key, query, shell.from, now)
  }
}
