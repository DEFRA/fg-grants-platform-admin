import { getFromGas, postToGas } from '../../common/gas.ts'

export type EventService = 'gas' | 'caseworking'
export type EventBox = 'inbox' | 'outbox'

/**
 * The seven statuses both services write today. `Event.status` is a plain string,
 * not this union: the endpoint passes a status through as written so a single
 * unexpected document cannot fail the whole page, and the badge map falls back
 * to a neutral role for anything it does not recognise. This union names what
 * is known, for the map and its tests, without narrowing the wire type.
 */
export type KnownEventStatus =
  | 'PUBLISHED'
  | 'PROCESSING'
  | 'FAILED'
  | 'RESUBMITTED'
  | 'COMPLETED'
  | 'DEAD_LETTER'
  /**
   * Set aside by an operator: a dead letter nobody is going to redrive until
   * something else is fixed, taken out of the retry machinery on purpose so it
   * stops being counted among the ones that still need a decision.
   */
  | 'PARKED'

/**
 * Why an event's last delivery attempt failed, as the endpoint reports it: the
 * error class, the one-line message, and when it happened. Null on a row that
 * has never failed — and `at` alone can be null on one that failed before the
 * timestamp was recorded.
 */
export interface EventLastError {
  name: string
  message: string
  at: string | null
}

/**
 * Why an event was set aside, as the operator who set it aside said it: when,
 * the reason they typed, and who they were. Null on every event that is not
 * parked — which is nearly all of them.
 */
export interface EventParked {
  at: string
  reason: string
  /** The `x-actor` the park was made with: a name, or an email address. */
  by: string
}

/** One inbox or outbox row, generic message plumbing only — never payload. */
export interface Event {
  service: EventService
  box: EventBox
  id: string
  eventId: string
  /**
   * The short type, as the column shows it verbatim. Null on a row that stores
   * no type at all — an audit record is not a CloudEvent and has none — which
   * the page renders as an absence rather than inventing a name for it.
   */
  type: string | null
  /** The un-stripped CloudEvent type; null whenever `type` is. */
  fullType: string | null
  source: string | null
  target: string | null
  segregationRef: string | null
  status: string
  attempts: number
  maxAttempts: number | null
  /**
   * The OpenSearch `trace.id` for this event: the 32-hex half of a W3C
   * traceparent, or a bare CDP request id, already extracted by GAS. Null when
   * the event carries no trace at all - every audit row, and anything
   * published before tracing.
   */
  traceId: string | null
  createdAt: string
  lastFailureAt: string | null
  completedAt: string | null
  /** The reason behind `lastFailureAt`; null on a row that never failed. */
  lastError: EventLastError | null
  /** Why this event was set aside, or null on one that was not. */
  parked: EventParked | null
}

export interface EventsPagination {
  // Null on an empty page: there is no row to take a keyset position from.
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

/**
 * A source that could not be read. `service` admits `gas`: exactly one GAS
 * source failing is a partial page, not an outage — only both GAS reads
 * failing is a 502. `message` is a fixed one-liner from the endpoint
 * ("timeout", "HTTP 401", "not configured"), never a response body.
 */
export interface SourceError {
  service: EventService
  box: EventBox
  message: string
}

export interface EventsPage {
  events: Event[]
  pagination: EventsPagination
  sourceErrors: SourceError[]
}

/**
 * The six parameters the page and the endpoint share, as plain strings. The
 * page does not police the enums — GAS owns them, answers 400 for a value it
 * does not know, and that 400 surfaces as this page's error alert. Validating
 * here would instead hand the user the shared govuk error page.
 */
export interface EventsQuery {
  cursor?: string
  direction?: string
  status?: string
  service?: string
  /** A free-text needle: an event id, a message id, or a reference. */
  q?: string
  /**
   * The window the page is asking about, as ISO instants. Both ends are
   * optional and independent: an operator asking "what broke overnight?" gives
   * a `from` and no `to`, and the endpoint reads an absent end as "until now".
   * The page converts the browser's `datetime-local` value into one of these;
   * what travels between here and GAS is always an instant, never a local
   * spelling of one.
   */
  from?: string
  to?: string
  /**
   * One failure, matched exactly: the whole of a `lastError.message`, as the
   * endpoint stored it. It is the parameter the top-failures panel hands back
   * — a group there is a message and a count, and clicking it has to narrow to
   * *that* message rather than to something like it, so no truncation, no
   * prefix matching and no normalising happens anywhere between the panel and
   * the query.
   */
  error?: string
}

const toSearch = <T extends object>(query: T): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined) as [
      string,
      string
    ][]
  )

  return params.size ? `?${params}` : ''
}

export const findEvents = async (query: EventsQuery): Promise<EventsPage> =>
  getFromGas<EventsPage>(`/grant-admin/events${toSearch(query)}`)

/**
 * How many events are in each state, across the whole dataset the current
 * filters describe — not across the page.
 *
 * The list is one keyset window and can only ever count itself, which made
 * every figure above the table a fact about twenty rows: `20 dead-lettered` on
 * a page of twenty dead letters says nothing about whether there are seven
 * thousand behind it. This endpoint answers the question the strip was
 * pretending to.
 *
 * Every status is reported, zero included: a bucket that vanished when it
 * emptied could not be told from a bucket the page forgot to draw.
 */
export interface EventCounts {
  PUBLISHED: number
  PROCESSING: number
  FAILED: number
  RESUBMITTED: number
  COMPLETED: number
  DEAD_LETTER: number
  /** Set aside by an operator, and deliberately not retried. */
  PARKED: number
}

/**
 * Every figure the toolbar is labelled with, in one read.
 *
 * The STATUS segments are the only ones that carry a number now. `counts`
 * honours every filter the page is holding — `status` excepted, which the
 * endpoint does not take, and which is precisely what makes `counts` the
 * status facet: every segment reports what selecting it would find, whatever
 * is selected now. The SERVICE segments are plain labels, so nothing here
 * divides by service any more.
 */
export interface EventFacets {
  counts: EventCounts
}

export interface EventCountsPage extends EventFacets {
  sourceErrors: SourceError[]
}

/**
 * The filters a count respects. `error` is among them — a page narrowed to one
 * failure has to be counted as narrowly as it is listed, or the figure the
 * `Redrive all N matching` button quotes is a figure about a wider set than the
 * one it would act on. `status` is deliberately absent — the counts
 * *are* the status breakdown, and narrowing them by one status would answer
 * with a single number and five zeroes. `cursor` is absent for the same reason
 * it is absent from a filter link: a keyset position is a fact about a page,
 * and these are facts about the whole set.
 */
export type EventCountsQuery = Pick<
  EventsQuery,
  'service' | 'q' | 'from' | 'to' | 'error'
>

export const findEventCounts = async (
  query: EventCountsQuery
): Promise<EventCountsPage> =>
  getFromGas<EventCountsPage>(`/grant-admin/events/counts${toSearch(query)}`)

/**
 * One event, in full: every field the list already knows plus the ones only
 * worth reading a row at a time — the stored event itself, the whole target
 * ARN, the ids that join it to a log line, and the four dates the poller
 * writes as it works.
 *
 * `payload` is whatever was published, verbatim: an arbitrary document this
 * app never inspects and only ever renders as text. `claimedBy` is
 * deliberately absent — the endpoint does not report who holds a claim, and a
 * field the page could only ever draw as empty is a field the page should not
 * have.
 */
/**
 * One delivery attempt, as the endpoint recorded it: when it was made, and the
 * error that ended it. Oldest first, and never more than the last ten — an
 * event that failed forty times says the same thing in ten.
 */
export interface EventAttempt {
  at: string
  name: string
  message: string
}

export interface EventDetail extends Event {
  /**
   * Every attempt the poller has a record of, oldest first. Always present:
   * an event written before the history was kept reports an empty list, which
   * the page says in words rather than drawing as an empty section.
   */
  attemptHistory: EventAttempt[]
  payload: unknown
  /** The whole target ARN, not the topic name the list cuts it down to. */
  targetRaw: string | null
  messageId: string | null
  /** The full W3C traceparent; `traceId` is the half OpenSearch indexes. */
  traceparent: string | null
  publicationDate: string | null
  completionDate: string | null
  lastResubmissionDate: string | null
  claimedAt: string | null
  claimExpiresAt: string | null
  /**
   * The last time somebody put this event back on the queue, and who. Null on
   * an event nobody has redriven — including every event redriven before the
   * backend started recording it.
   */
  lastRedrive: EventLastRedrive | null
}

/** One redrive, as the backend recorded it: when, and who asked. */
export interface EventLastRedrive {
  at: string
  by: string
}

/** The endpoint's key for one message: which service, which box, which row. */
export interface EventKey {
  service: string
  box: string
  id: string
}

/** What a redrive answers with: the same row, resubmitted and back at zero. */
export interface RedrivenEvent {
  event: Event
}

const toPath = ({ service, box, id }: EventKey): string =>
  `/grant-admin/events/${encodeURIComponent(service)}/${encodeURIComponent(box)}/${encodeURIComponent(id)}`

export const findEvent = async (key: EventKey): Promise<EventDetail> =>
  getFromGas<EventDetail>(toPath(key))

/**
 * Puts one dead-lettered event back on the queue.
 *
 * The endpoint answers 409 when the event has
 * moved on since the page was drawn — the status it is in now travels on that
 * body — and the use case turns each answer into something the page can say.
 */
export const redriveEvent = async (
  key: EventKey,
  actor?: string
): Promise<RedrivenEvent> =>
  postToGas<RedrivenEvent>(`${toPath(key)}/redrive`, { actor })

/**
 * The dead letters on this page's filters, grouped by the failure that caused
 * them.
 *
 * A page of seven thousand dead letters is not seven thousand incidents. It is
 * usually three: one topic misconfigured, one downstream service that was down
 * for an hour, and a duplicate key nobody has fixed. The list cannot say that —
 * it is one keyset window, ordered by time, and the shape of the incident is
 * spread across three hundred pages of it — so this asks the question the list
 * cannot: which failures, how many of each, and how long each has been running.
 *
 * Dead letters only, and never more than twenty groups, count descending. The
 * `error` on a group travels back verbatim as `?error=` and is the whole
 * message, not a prefix of it.
 */
export interface EventBreakdownGroup {
  /** The whole `lastError.message`, or null for the ones that recorded none. */
  error: string | null
  /**
   * The short type the rows in this group share, or null for the group of rows
   * that store none at all — audit records, which are not CloudEvents.
   */
  type: string | null
  count: number
  firstAt: string
  lastAt: string
}

export interface EventBreakdownPage {
  groups: EventBreakdownGroup[]
  sourceErrors: SourceError[]
}

/**
 * `status` is absent because the breakdown is only ever about dead letters, and
 * `error` because the breakdown is what produces them.
 */
export type EventBreakdownQuery = Pick<
  EventsQuery,
  'service' | 'q' | 'from' | 'to'
>

export const findEventBreakdown = async (
  query: EventBreakdownQuery
): Promise<EventBreakdownPage> =>
  getFromGas<EventBreakdownPage>(
    `/grant-admin/events/breakdown${toSearch(query)}`
  )

/**
 * The filters a bulk redrive acts on — the page's own filters, and a limit.
 *
 * It is deliberately the same vocabulary the list is read in. An operator
 * narrows the page until it holds exactly the failures they mean to retry, and
 * then redrives *that*: the button they press is the filter they are looking
 * at, not a second query they have to restate and could get wrong.
 */
export interface RedriveQueryQuery {
  service?: string
  q?: string
  error?: string
  from?: string
  to?: string
  /** At most 500, which is also the default the endpoint applies. */
  limit?: string
}

/** How one source fared, on a write that spans four of them. */
export interface RedriveQuerySource {
  service: string
  box: string
  matched?: number
  processed?: number
  redriven?: number
  conflicts?: number
  failures?: number
}

/**
 * What a bulk redrive came to.
 *
 * Five figures rather than one, because "it worked" is not a thing that
 * happens to five hundred events at once: some were redriven, some had moved
 * on since the page was drawn, some could not be written at all, and — when
 * more matched than one run may process — some were not reached. `processed`
 * below `matched` is the signal that another run is needed, and the results
 * page says so rather than leaving an operator to compare two numbers.
 */
export interface RedriveQueryResult {
  matched: number
  processed: number
  redriven: number
  conflicts: number
  failures: number
  perSource: RedriveQuerySource[]
  sourceErrors: SourceError[]
}

/**
 * Redrives every dead letter the given filters describe, up to the limit.
 *
 * The filters travel in the query string, exactly as they do on the read that
 * showed them: the operator confirmed a page that said `7,064 matched`, and the
 * write has to be the same question asked again rather than a second spelling
 * of it. `x-actor` names who asked.
 */
export const redriveByQuery = async (
  query: RedriveQueryQuery,
  actor?: string
): Promise<RedriveQueryResult> =>
  postToGas<RedriveQueryResult>(
    `/grant-admin/events/redrive-query${toSearch(query)}`,
    { actor }
  )

/**
 * Sets one dead letter aside, with the reason the operator typed.
 *
 * The opposite of a redrive rather than a kind of one: nothing is queued, the
 * event stops being counted among the dead letters that still need a decision,
 * and the reason is what tells the next operator why they should leave it
 * alone. The endpoint answers 409 when the event is no longer dead-lettered,
 * carrying the status it is in now, exactly as a redrive does.
 */
export const parkEvent = async (
  key: EventKey,
  reason: string,
  actor?: string
): Promise<RedrivenEvent> =>
  postToGas<RedrivenEvent>(`${toPath(key)}/park`, {
    payload: { reason },
    actor
  })

/** Puts a parked event back among the dead letters, for somebody to decide. */
export const unparkEvent = async (
  key: EventKey,
  actor?: string
): Promise<RedrivenEvent> =>
  postToGas<RedrivenEvent>(`${toPath(key)}/unpark`, { actor })
