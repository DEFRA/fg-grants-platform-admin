import type {
  Event,
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import type { BadgeRole } from './event-formats.ts'
import {
  isAtMaxAttempts,
  noTimestamp,
  toAbsolute,
  toAttempts,
  toEventHref,
  toGap,
  toIso,
  toLatency,
  toRoute,
  toSearchHref,
  toSearchTitle,
  toSourceName,
  toStatusBadge,
  toStatusLabel,
  toTimestamp,
  toTraceHref
} from './event-formats.ts'

/**
 * The page for one event, and the answer to the question the list cannot: what
 * was actually published, where it went, and what happened to it since.
 *
 * The list is a scanning surface and every value on it is cut to a column
 * width. Nothing is cut here. An operator opens this page holding one row and
 * needing to paste something out of it — an ARN, a message id, a traceparent,
 * the payload — so every value is shown whole, in mono where it is a machine
 * string, with a copy button beside the ones worth carrying somewhere else.
 */

/** A `—`, said the same way everywhere a value is simply not there. */
const none = '—'

/** One hop on the journey table: a row somewhere with the same event id. */
export interface JourneyHop {
  /** `GAS · Outbox` — which queue this hop is, in the alert's vocabulary. */
  source: string
  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  createdAt: string
  createdAtTitle: string
  /**
   * How long this hop itself took, created to completed: `430ms`, `1.2s`. A
   * journey is three rows that each took a different amount of time, and the
   * table said only when each of them started — so the one question the table
   * is actually read for, which hop is slow, was the one it could not answer.
   * `—` on a hop that has not completed: an unfinished hop has no duration, and
   * a zero there would read as an instant one.
   */
  took: string
  /** This hop's own page, carrying the same `from` as the page it is on. */
  href: string
  /**
   * The hop the operator is already looking at. Marked rather than unlinked:
   * a table where one row is missing its link reads as a broken row, and the
   * mark says which one is the page instead.
   */
  isCurrent: boolean
}

/**
 * One delivery attempt, as the timeline draws it.
 *
 * The page used to say `attempts 5/5` and then, on one line, why the last of
 * them failed — which is the story of the fifth attempt told as if it were the
 * story of the event. The four before it are where the answer usually is: a
 * timeout, then a timeout, then a duplicate key is a different incident from
 * four duplicate keys, and neither is visible in the count.
 */
export interface AttemptEntry {
  /** `#1`, oldest first — the order they happened, not the order they matter. */
  number: string
  /**
   * The instant, whole, milliseconds and all — and the primary value of the
   * line rather than a parenthesis after a relative one.
   *
   * A timeline of `4h 24m ago`, `4h 24m ago`, `4h 24m ago` says nothing: five
   * attempts inside one minute all round to the same phrase, which is exactly
   * the case the timeline is read in. Milliseconds are kept for the same
   * reason — the gap between two attempts of a service retrying into a wall is
   * measured in them.
   */
  absolute: string
  /**
   * How long after the attempt before it this one was made — `+273ms`,
   * `+1.2s`, `+5h 34m` — and, on the first, how long after the event was
   * created: `after 273ms`.
   *
   * This is the whole point of the timeline. A missing backoff is four
   * attempts inside a second, and nothing in a column of timestamps says so
   * until something subtracts them. Null only when an instant will not parse.
   */
  delta: string | null
  name: string
  message: string
  /** Both spellings of the instant, for anyone hovering the line. */
  title: string
}

/** The one thing a redirect after a write has to say when it lands. */
export interface EventBanner {
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
   * The type, drawn UNDER the id as the secondary half of the identity. Null on
   * an event that stores none — an audit record is not a CloudEvent — and the
   * line is then simply not drawn. The heading is the id, which is always
   * there, so nothing has to stand in for an absent type.
   */
  type: string | null
  /** The endpoint's own spelling, on the type's `title`, when the two differ. */
  typeTitle: string | null
  /** The un-stripped CloudEvent type; null whenever `type` is. */
  fullType: string | null
  eventId: string

  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  isDeadLetter: boolean
  /** `3/5`, or `-` when the endpoint reported no count. */
  attempts: string
  attemptsAtMax: boolean
  showAttempts: boolean
  hasFailure: boolean
  lastFailureAt: string
  failureTitle: string

  routeFrom: string
  routeTo: string
  routeToIsTopic: boolean
  routeToTitle: string | null
  routeDetail: string
  /** The whole ARN, under the route it is the machine spelling of. */
  targetRaw: string | null

  segregationRef: string | null
  segregationRefHref: string | null
  segregationRefTitle: string | null
  messageId: string | null
  traceparent: string | null
  traceId: string | null
  traceHref: string | null

  /** The instant absolutely: the ISO UTC spelling a log query takes. */
  createdAtAbsolute: string

  /** Absolute UTC, or `—`: the four dates the poller writes as it works. */
  publicationDate: string
  completionDate: string
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
   * an empty section reads as "it never failed", which is the opposite of what
   * an empty history means on a dead letter.
   */
  attemptHistory: AttemptEntry[]
  attemptCount: number
  /**
   * Where the timeline ends: `dead-lettered`, or `completed at <instant>`. The
   * last line of the story, so a list of five failures does not trail off
   * without saying which way it went. Null while the event is still in play.
   */
  attemptOutcome: string | null

  /** The stored event, pretty-printed. Null when there is nothing stored. */
  payloadJson: string | null

  journey: JourneyHop[]
  journeyCount: number

  /** Dead-lettered, and therefore worth offering to put back on the queue. */
  canRedrive: boolean
  /** The operator asked for the confirmation, and it is theirs to confirm. */
  confirmRedrive: boolean
  redriveHref: string
  cancelHref: string
  /** Where the confirmation posts: the endpoint's own path, on this app. */
  redriveAction: string

  /**
   * The other decision a dead letter admits: set it aside, with a reason.
   *
   * Offered on exactly the status the redrive is offered on, because they are
   * the two answers to the same question. Most of a real dead-letter queue is
   * four hundred copies of one failure that will fail again until somebody
   * fixes a topic ARN, and until now the page's only verb for that was
   * `Redrive` — which is the wrong answer, twice.
   */
  canPark: boolean
  confirmPark: boolean
  parkHref: string
  parkAction: string
  /** Parked already, and therefore worth offering to put back in the queue. */
  canUnpark: boolean
  confirmUnpark: boolean
  unparkHref: string
  unparkAction: string
  /**
   * Why this event was set aside, as one line of the facts list: the reason
   * somebody typed, who they were, and at what instant. Null on an event nobody
   * parked — which is a fact worth no row at all rather than a row of dashes.
   */
  parkedFact: string | null
  /** The reason and both spellings of the instant, for the row's title. */
  parkedTitle: string
  /**
   * The last redrive, said as the facts list says an instant: the absolute
   * UTC spelling, and the person who asked. Null when nobody has redriven
   * this event, or when it was redriven before the backend recorded who did.
   */
  lastRedriveFact: string | null
  /** That instant whole, for the copy button the row carries. */
  lastRedriveValue: string
  lastRedriveTitle: string
  /**
   * The sentence above the buttons on an event whose last redrive achieved
   * nothing. Null unless every part of that is true — see `toFutileWarning`.
   */
  futileWarning: string | null
  /**
   * Every other dead letter that failed the same way, one click from the
   * failure that is on screen. Null on an event with no error recorded, and on
   * one that is not a dead letter: the question only means something about the
   * population the panel on the list counts.
   */
  errorSearchHref: string | null
}

/**
 * The back link's suffix, and the only untrusted string this page puts in an
 * href.
 *
 * It arrives as an opaque query string the list handed out, and it is only
 * ever appended to `/dev-ops/events` — so the two things that could turn that
 * into a link somewhere else are the two things checked here. A value that
 * does not open with `?` is not a query string at all; a value containing `//`
 * is how `/dev-ops/events` plus a suffix becomes a protocol-relative url
 * pointing at another host. Anything failing either test is dropped rather
 * than repaired: the plain list is a perfectly good answer, and a 400 for a
 * link the operator did not type is not.
 */
export const toSafeFrom = (from: string | undefined | null): string =>
  typeof from === 'string' && from.startsWith('?') && !from.includes('//')
    ? from
    : ''

/** The list, as the operator left it — or the plain list if we cannot tell. */
const toBackHref = (from: string): string => `/dev-ops/events${from}`

/** This page's own url, with `from` kept and one parameter added or not. */
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

/** An instant spelled the one way it can be pasted, or nothing at all. */
const toAbsoluteOrNone = (value: string | null): string =>
  value === null ? none : (toAbsolute(value) ?? none)

/** The instant whole for a tooltip, or nothing to hover on a bad date. */
const toIsoOrEmpty = (value: string): string => toIso(value) ?? ''

/**
 * The line under the status, exactly as the list draws it: a count is only
 * worth printing when it says something. A row on its first attempt that has
 * never failed has nothing to report.
 */
const showsAttempts = (attempts: number | null | undefined, failed: boolean) =>
  failed || (attempts != null && attempts > 1)

/**
 * The whole document that was published, indented two spaces.
 *
 * Rendered as text and nothing else: nunjucks escapes it on the way into the
 * `<pre>`, so a payload containing markup is a payload an operator can read
 * rather than a script this page runs. `undefined` is the one shape with
 * nothing to print — a stored `null` is a real payload and says so.
 */
const toPayloadJson = (payload: unknown): string | null =>
  payload === undefined ? null : JSON.stringify(payload, null, 2)

/**
 * Every row the list endpoint holds under this event id, in the order it
 * returned them. The current hop is marked rather than unlinked: an operator
 * needs to see where they are in the sequence, and a row without a link reads
 * as a row that is broken.
 */
const toJourney = (
  events: Event[],
  key: EventKey,
  from: string
): JourneyHop[] =>
  events.map((hop) => {
    const badge = toStatusBadge(hop.status)

    return {
      source: toSourceName(hop),
      status: hop.status,
      statusLabel: toStatusLabel(hop.status),
      statusRole: badge.role,
      statusRetrying: badge.retrying,
      createdAt: toAbsoluteOrNone(hop.createdAt),
      createdAtTitle: toIsoOrEmpty(hop.createdAt),
      took: toLatency(hop.createdAt, hop.completedAt) ?? none,
      href: toSelfHref(hop, from),
      isCurrent:
        hop.service === key.service && hop.box === key.box && hop.id === key.id
    }
  })

/**
 * What the redirect after a write left in the url, said as a sentence.
 *
 * A write that redirects has to carry its own result, because the page that
 * lands is a fresh read that knows nothing about the click that caused it. The
 * conflict is the one worth spelling carefully: nothing went wrong, the event
 * simply moved on, and the banner names the state it is actually in rather
 * than reporting a failure the operator would go looking for.
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
      message: `Not redriven — this event is no longer dead-lettered. Its status is now ${toStatusLabel(status)}.`
    })
  },
  {
    reads: (query) => query.parked,
    toBanner: () => ({
      role: 'success',
      message:
        'Parked — this event is set aside and will not be retried. Unpark it to put it back among the dead letters.'
    })
  },
  {
    reads: (query) => query.unparked,
    toBanner: () => ({
      role: 'success',
      message:
        'Unparked — this event is a dead letter again, and can be redriven.'
    })
  },
  {
    reads: (query) => query.park_conflict,
    toBanner: (status) => ({
      role: 'warning',
      message: `Not changed — this event has moved on since the page was drawn. Its status is now ${toStatusLabel(status)}.`
    })
  },
  {
    reads: (query) =>
      query.park_error === 'missing' ? query.park_error : undefined,
    toBanner: () => ({
      role: 'error',
      message:
        'Not changed — fg-gas-backend no longer has this event. Nothing has changed.'
    })
  },
  {
    reads: (query) => query.park_error,
    toBanner: () => ({
      role: 'error',
      message:
        'Not changed — fg-gas-backend could not be reached. Nothing has changed.'
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

/** The query this page reads: where the operator came from, and what happened. */
export interface EventPageQuery {
  from?: string
  confirm?: string
  redriven?: string
  redrive_conflict?: string
  redrive_error?: string
  parked?: string
  unparked?: string
  park_conflict?: string
  park_error?: string
}

/**
 * The shell of the page, and everything it can say without an event: the way
 * back, and whatever the redirect that landed here was carrying.
 */
const toShell = (key: EventKey, query: EventPageQuery) => {
  const from = toSafeFrom(query.from)

  return {
    from,
    backHref: toBackHref(from),
    banner: toBanner(query),
    redriveAction: `${toEventHref(key)}/redrive`,
    parkAction: `${toEventHref(key)}/park`,
    unparkAction: `${toEventHref(key)}/unpark`
  }
}

const emptyDetail = {
  type: null,
  typeTitle: null,
  fullType: null,
  eventId: '',
  status: '',
  statusLabel: '',
  statusRole: 'neutral' as BadgeRole,
  statusRetrying: false,
  isDeadLetter: false,
  attempts: '-',
  attemptsAtMax: false,
  showAttempts: false,
  hasFailure: false,
  lastFailureAt: none,
  failureTitle: '',
  routeFrom: '',
  routeTo: '',
  routeToIsTopic: false,
  routeToTitle: null,
  routeDetail: '',
  targetRaw: null,
  segregationRef: null,
  segregationRefHref: null,
  segregationRefTitle: null,
  messageId: null,
  traceparent: null,
  traceId: null,
  traceHref: null,
  createdAtAbsolute: none,
  publicationDate: none,
  completionDate: none,
  lastResubmissionDate: none,
  claimedAt: none,
  claimExpiresAt: none,
  errorName: null,
  errorMessage: null,
  errorAt: null,
  attemptHistory: [] as AttemptEntry[],
  attemptCount: 0,
  attemptOutcome: null as string | null,
  payloadJson: null,
  journey: [] as JourneyHop[],
  journeyCount: 0,
  canRedrive: false,
  confirmRedrive: false,
  redriveHref: '',
  cancelHref: '',
  canPark: false,
  confirmPark: false,
  parkHref: '',
  canUnpark: false,
  confirmUnpark: false,
  unparkHref: '',
  parkedFact: null as string | null,
  parkedTitle: '',
  lastRedriveFact: null as string | null,
  lastRedriveValue: '',
  lastRedriveTitle: '',
  futileWarning: null as string | null,
  errorSearchHref: null as string | null
}

/** What state the event is in, and how hard it has been trying. */
const toState = (event: EventDetail) => {
  const badge = toStatusBadge(event.status)
  const failedAt =
    event.lastFailureAt === null ? null : toAbsolute(event.lastFailureAt)
  const hasFailure = failedAt !== null

  return {
    status: event.status,
    statusLabel: toStatusLabel(event.status),
    statusRole: badge.role,
    statusRetrying: badge.retrying,
    isDeadLetter: event.status === 'DEAD_LETTER',
    attempts: toAttempts(event.attempts, event.maxAttempts),
    attemptsAtMax: isAtMaxAttempts(event.attempts, event.maxAttempts),
    showAttempts: showsAttempts(event.attempts, hasFailure),
    hasFailure,
    lastFailureAt: failedAt ?? none,
    failureTitle: failedAt ?? noTimestamp.title
  }
}

/** The reference and the link it carries — or three nulls, together. */
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

/** Every instant on the event, stated absolutely: the ISO UTC spelling. */
const toDates = (event: EventDetail) => ({
  createdAtAbsolute: toAbsoluteOrNone(event.createdAt),
  publicationDate: toAbsoluteOrNone(event.publicationDate),
  completionDate: toAbsoluteOrNone(event.completionDate),
  lastResubmissionDate: toAbsoluteOrNone(event.lastResubmissionDate),
  claimedAt: toAbsoluteOrNone(event.claimedAt),
  claimExpiresAt: toAbsoluteOrNone(event.claimExpiresAt)
})

/** Nothing to say about a failure on an event that has never had one. */
const noFailure = { errorName: null, errorMessage: null, errorAt: null }

/**
 * The failure in three parts, because the page draws it in three: the class
 * beside the whole message, and the instant on a line of its own. `at` alone
 * can be missing on an event that failed before the timestamp was recorded.
 */
const toFailure = (error: EventDetail['lastError']) =>
  error === null
    ? noFailure
    : {
        errorName: error.name,
        errorMessage: error.message,
        errorAt: error.at === null ? null : toAbsoluteOrNone(error.at)
      }

/**
 * The gap in front of one attempt: since the one before it, or — on the first
 * — since the event was created, which is the only earlier instant there is.
 *
 * The two are labelled differently on purpose. `+273ms` is a gap between two
 * attempts and reads down the column as a backoff; `after 273ms` is a
 * different measurement against a different instant, and spelling both with a
 * `+` would invite the first line to be read as part of the same series.
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
 * The attempts, oldest first and numbered as they happened.
 *
 * The endpoint caps the list at ten, so a message that failed forty times
 * still fits on the page; the numbers are the positions in what was kept, not
 * in what happened, which is the honest thing to draw when the earliest of
 * forty are gone.
 *
 * Absolute, not relative. Every line of a retry storm is `4h 24m ago`, because
 * five attempts inside one minute round to one phrase — and the timeline is
 * read precisely in that case. The instant is drawn whole, milliseconds and
 * all, with the gap since the previous attempt beside it: that pair is what
 * makes a missing backoff visible without anybody doing arithmetic.
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
    title: toTimestamp(attempt.at, now).title
  }))

/**
 * How the story ends, on the events where it has. A list of five failures that
 * stops without a word reads as an event still failing; these two lines say
 * which of the two things actually happened to it.
 */
const toCompletedOutcome = (event: EventDetail): string | null => {
  const completed = event.completionDate ?? event.completedAt

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
 * The one action, and the two urls that stand either side of confirming it.
 * It is only ever offered on the status it is for, and the confirmation is a
 * url rather than a piece of script: `?confirm=redrive` is the same page with
 * a panel on it, which back-buttons and reloads like every other state of it.
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
 * Why this event was set aside, as one line: the reason, who set it, and at
 * what instant.
 *
 * The reason is first because it is the only part anybody reads twice — the
 * page is opened on a parked event to find out why it is parked. The instant
 * is stated absolutely: a relative time is unquotable, and the UTC ISO
 * spelling is the one a log query takes.
 */
const toParkedDetail = (parked: EventDetail['parked']) => {
  if (parked == null) {
    return { parkedFact: null, parkedTitle: '' }
  }

  return {
    parkedFact: `${parked.reason} · by ${parked.by} · ${toAbsoluteOrNone(parked.at)}`,
    parkedTitle: toAbsoluteOrNone(parked.at)
  }
}

/**
 * The last time somebody put this event back on the queue, and who.
 *
 * It is the fact that turns a page of five identical failures into a story: an
 * event that failed five times on its own is a broken message, and an event
 * that failed, was redriven by a named person and failed again the same way is
 * a broken *system*, which is a different thing to do about it. The instant is
 * stated absolutely — the UTC ISO spelling a log query takes — because a
 * relative time is unquotable and goes stale in an open tab.
 */
const toLastRedriveDetail = (lastRedrive: EventDetail['lastRedrive']) => {
  if (lastRedrive == null) {
    return { lastRedriveFact: null, lastRedriveValue: '', lastRedriveTitle: '' }
  }

  const absolute = toAbsoluteOrNone(lastRedrive.at)

  return {
    lastRedriveFact: `${absolute} · by ${lastRedrive.by}`,
    // The instant whole, milliseconds and all, for the copy button beside it.
    lastRedriveValue: toIso(lastRedrive.at) ?? '',
    lastRedriveTitle: absolute
  }
}

/**
 * Whether redriving this again would only produce the same failure a third
 * time.
 *
 * Every part of the condition earns its place. A dead letter, because nothing
 * else can be redriven. Two attempts or more, because one attempt is not a
 * pattern. The last two messages identical, because a timeout followed by a
 * duplicate key is a system that changed its mind and worth another go. And a
 * redrive on record, because without one the two identical failures are just
 * the poller doing its job — nobody has tried anything yet, and warning them
 * off before they have would be this page refusing to let an operator make the
 * obvious first move.
 *
 * It is a note and not a block: the operator may know something the page does
 * not, and the button stays exactly where it was.
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
    'redriving again is unlikely to succeed until the underlying cause is fixed. Consider Park.'
  )
}

/**
 * Every other dead letter that failed this same way.
 *
 * One event's error is almost never one event's problem, and the operator
 * holding this page is one click from finding out whether they are looking at
 * an incident or an oddity. The whole message travels on `?error=`, unshortened
 * — the endpoint matches it exactly, and a truncated needle would quietly
 * answer a wider question than the one that was asked.
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
 * The two actions a dead letter admits, and the two urls that stand either side
 * of each: exactly the anatomy the redrive already has, because they are three
 * answers to one question and an operator should not have to learn three ways
 * of being asked it. `?confirm=park` is the same page with a panel on it, which
 * back-buttons and reloads like every other state of it.
 */
const toParkActions = (
  event: EventDetail,
  key: EventKey,
  query: EventPageQuery,
  from: string
) => {
  const isDeadLetter = event.status === 'DEAD_LETTER'
  const isParked = event.status === 'PARKED'

  return {
    canPark: isDeadLetter,
    confirmPark: isDeadLetter && query.confirm === 'park',
    parkHref: toSelfHref(key, from, ['confirm', 'park']),
    canUnpark: isParked,
    confirmUnpark: isParked && query.confirm === 'unpark',
    unparkHref: toSelfHref(key, from, ['confirm', 'unpark'])
  }
}

const toDetail = (
  event: EventDetail,
  journey: Event[],
  key: EventKey,
  query: EventPageQuery,
  from: string,
  now: Date
) => {
  const state = toState(event)

  return {
    type: event.type,
    typeTitle: event.fullType === event.type ? null : event.fullType,
    fullType: event.fullType,
    eventId: event.eventId,
    ...state,
    ...toRoute(event),
    targetRaw: event.targetRaw,
    ...toReference(event.segregationRef),
    messageId: event.messageId,
    traceparent: event.traceparent,
    traceId: event.traceId,
    traceHref: toTraceHref(event),
    ...toDates(event),
    ...toFailure(event.lastError),
    attemptHistory: toAttemptHistory(
      event.attemptHistory,
      event.createdAt,
      now
    ),
    attemptCount: (event.attemptHistory ?? []).length,
    attemptOutcome: toAttemptOutcome(event),
    payloadJson: toPayloadJson(event.payload),
    journey: toJourney(journey, key, from),
    journeyCount: journey.length,
    ...toRedrive(state.isDeadLetter, key, query, from),
    ...toParkActions(event, key, query, from),
    ...toParkedDetail(event.parked),
    ...toLastRedriveDetail(event.lastRedrive),
    futileWarning: toFutileWarning(event),
    errorSearchHref: toErrorSearchHref(event)
  }
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
    return { unavailable: true, ...shell, ...emptyDetail }
  }

  return {
    unavailable: false,
    ...shell,
    ...toDetail(event, journey, key, query, shell.from, now)
  }
}
