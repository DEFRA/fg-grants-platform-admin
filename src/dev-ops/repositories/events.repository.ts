import { getFromGas, postToGas } from '../../common/gas.ts'
import type { BadgeRole } from '../view-models/event-formats.ts'

export type EventService = 'gas' | 'caseworking'
export type EventBox = 'inbox' | 'outbox'

/**
 * Why an event's last delivery attempt failed. Null on a row that has never
 * failed — and `at` alone can be null on one that failed before the timestamp
 * was recorded.
 */
export interface EventLastError {
  name: string
  message: string
  at: string | null
}

/**
 * The words a status is drawn in, decided by fg-gas-backend: a label derived
 * in two places eventually reads two ways, so the endpoint states it and
 * every surface here prints it.
 */
export interface StatusDisplay {
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
}

/**
 * One inbox or outbox row, ready to draw: generic message plumbing only, never
 * payload. Almost every string arrives finished; what is not is what this app
 * is the authority on — the instants, phrased against the clock at render
 * time, and `service`/`box`/`id`, out of which it builds the row's links.
 */
export interface Event extends StatusDisplay {
  service: EventService
  box: EventBox
  id: string
  eventId: string
  /**
   * The short type. Always a string: a record that is not a CloudEvent is
   * labelled `audit` by fg-gas-backend rather than leaving this page to
   * invent a name for an absence.
   */
  type: string
  /** `GAS Outbox` — which hop of the journey this row is. */
  hop: string
  /**
   * The line under it: `to Caseworking` on an outbox row, `from Agreements` on
   * an inbox one. Null only where an outbox row names no target at all.
   */
  queue: string | null
  /** The topic itself, for that line's title. Null on an inbox row. */
  queueValue: string | null
  /** The raw value, which rides `?status=` and the badge's own title. */
  status: string
  createdAt: string
  /** Why the last attempt failed; null on a row that never failed. */
  lastError: EventLastError | null
}

/** What the LIST adds, and only the list: the column no other surface draws. */
export interface EventRow extends Event {
  /** `1.2s`, or null on a row that has not completed. */
  latency: string | null
  latencyTitle: string
}

/**
 * What a SINGLE-ROW answer adds. The list's Status column drew an attempt
 * count until the operators asked for it back; the detail still draws one, so
 * these travel on the detail alone — the endpoint sends no list row a figure
 * this app would not print.
 */
export interface EventWithAttempts extends Event {
  /** `5/5` — attempts made over attempts allowed. */
  attempts: string
  /** Whether that figure says anything a healthy row does not. */
  showAttempts: boolean
  lastFailureAt: string | null
}

/**
 * One hop of this message's journey, timed from when THAT box took the
 * message.
 */
export interface JourneyHop extends StatusDisplay {
  service: EventService
  box: EventBox
  id: string
  hop: string
  status: string
  startedAt: string
  took: string | null
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
  /** `CW Inbox` — the same words the rows use for that pair. */
  hop: string
  message: string
}

/** One chip's vocabulary: what a value is called, and what it means. */
export interface StatusFilter {
  value: string
  label: string
  explainer: string
}

export interface ServiceFilter {
  value: string
  label: string
}

export interface EventsPage {
  events: EventRow[]
  pagination: EventsPagination
  sourceErrors: SourceError[]
}

/**
 * The parameters the page and the endpoint share, as plain strings. The enums
 * among them are checked at the route rather than here (see
 * view-models/event-filters.ts): a value this app never offers is a url
 * nobody issued, and forwarding it only to draw the 400 as "could not be
 * loaded from GAS" reported a typo as an outage.
 */
export interface EventsQuery {
  cursor?: string
  direction?: string
  status?: string
  service?: string
  /** A free-text needle: an event id, a message id, or a reference. */
  q?: string
  /**
   * The window, as ISO instants. Both ends optional and independent — the
   * endpoint reads an absent end as "until now". What travels between here
   * and GAS is always an instant, never a local spelling of one.
   */
  from?: string
  to?: string
  /**
   * One failure, matched exactly: the whole of a `lastError.message` as the
   * endpoint stored it. No truncation, prefix matching or normalising happens
   * anywhere between the top-failures panel and the query — clicking a group
   * has to narrow to *that* message rather than to something like it.
   */
  error?: string
  /**
   * Whether the audit records are in the population at all; absent means they
   * are not, `include` puts them back. A filter dimension like any other: the
   * endpoint applies it to the rows, the counts and the failures panel
   * together, which is what keeps the figures on the chips agreeing with the
   * rows underneath them.
   */
  audit?: string
}

const toSearchString = <T extends object>(query: T): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined) as [
      string,
      string
    ][]
  )

  return params.size ? `?${params}` : ''
}

/**
 * Why one section of a page could not be read. `section` names it — `counts`
 * or `breakdown` on the list, `journey` on one event. A section the endpoint
 * answered null for always has one.
 */
export interface SectionError {
  section: string
  message: string
}

/**
 * Everything the list page draws, in one read: fg-gas-backend composes the
 * page and this app renders it.
 *
 * The two aggregations are nullable and the rows are not, which is the
 * degradation contract stated in the type: a page whose counts failed is a
 * page with rows and no figures, and a page whose rows failed is not a page.
 * A null section always has its reason in `sectionErrors`.
 */
export interface EventsPageResponse extends EventsPage {
  /**
   * The vocabulary the toolbar's chips are drawn in, in the order a message
   * travels. A constant of the endpoint rather than a read that can fail, so
   * it is never null.
   */
  statuses: StatusFilter[]
  services: ServiceFilter[]
  counts: EventCounts | null
  breakdown: EventBreakdownPage | null
  sectionErrors: SectionError[]
}

export const findEventsPage = async (
  query: EventsQuery
): Promise<EventsPageResponse> =>
  getFromGas<EventsPageResponse>(
    `/grant-admin/events/page${toSearchString(query)}`
  )

/**
 * How many events are in each state, across the whole dataset the current
 * filters describe — not across the page. Every status is reported, zero
 * included: a bucket that vanished when it emptied could not be told from a
 * bucket the page forgot to draw.
 */
export interface EventCounts {
  PUBLISHED: number
  PROCESSING: number
  FAILED: number
  RESUBMITTED: number
  COMPLETED: number
  DEAD_LETTER: number
}

/**
 * `counts` honours every filter the page is holding — `status` excepted,
 * which the endpoint does not take, and which is precisely what makes it the
 * status facet: every segment reports what selecting it would find, whatever
 * is selected now.
 */
export interface EventFacets {
  counts: EventCounts
}

/**
 * One delivery attempt, as the endpoint recorded it. Oldest first, and never
 * more than the last ten.
 */
export interface EventAttempt {
  at: string
  name: string
  message: string
  /**
   * The stack this attempt failed with, verbatim from the backend and capped
   * there. Null where there is nothing to reveal — an event written before
   * stacks were recorded, a claim-expiry sweep, a thrown string — and the page
   * draws no expander at all on those rows.
   */
  stack: string | null
}

/**
 * One event, in full. `payload` is whatever was published, verbatim: an
 * arbitrary document this app never inspects and only ever renders as text.
 * `claimedBy` is deliberately absent — the endpoint does not report who holds
 * a claim, and a field the page could only ever draw as empty is a field the
 * page should not have.
 */
export interface EventDetail extends EventWithAttempts {
  /**
   * Always present: an event written before the history was kept reports an
   * empty list, which the page says in words rather than drawing as an empty
   * section.
   */
  attemptHistory: EventAttempt[]
  payload: unknown
  /**
   * The full type, but only where it says something the short one does not —
   * null when the two agree, so this hangs on a title without being compared
   * to anything first.
   */
  typeTitle: string | null
  /** When the producer says the thing happened, out of the payload. */
  occurredAt: string | null
  /** And the FIFO group it was published under. */
  messageGroupId: string | null
  /**
   * Three facts only an inbox row can answer — which case it belongs to, and
   * the trace it arrived on. Absent, not null, on an outbox row: something
   * this service published has no reference to segregate by and no trace of
   * its own.
   */
  segregationRef?: string | null
  traceparent?: string | null
  traceId?: string | null
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
  service: EventService
  box: EventBox
  id: string
}

/** What a redrive answers with: the same row, resubmitted and back at zero. */
export interface RedrivenEvent {
  event: EventWithAttempts
}

/**
 * The three segments that address one event, escaped one at a time: a service
 * or a box this app has never heard of is still only ever a single path
 * segment. Each caller prefixes its own route — fg-gas-backend's endpoint
 * here, this app's own page in `toEventHref` — so the escaping is written once
 * and the two spellings of an address cannot drift apart.
 */
export const toEventKeyPath = ({ service, box, id }: EventKey): string =>
  `${encodeURIComponent(service)}/${encodeURIComponent(box)}/${encodeURIComponent(id)}`

const toPath = (key: EventKey): string =>
  `/grant-admin/events/${toEventKeyPath(key)}`

/**
 * One event and everything its page draws, in one read. `journey` is nullable
 * for the same reason the list page's aggregations are: a journey that could
 * not be read is a page with an event on it and no hop table, which is a far
 * better answer than no page. `sectionErrors` says why.
 */
export interface EventDetailPage extends EventDetail {
  journey: JourneyHop[] | null
  sectionErrors: SectionError[]
}

export const findEvent = async (key: EventKey): Promise<EventDetailPage> =>
  getFromGas<EventDetailPage>(toPath(key))

/**
 * Puts one dead-lettered event back on the queue. The endpoint answers 409
 * when the event has moved on since the page was drawn — the status it is in
 * now travels on that body.
 */
export const redriveEvent = async (
  key: EventKey,
  actor?: string
): Promise<RedrivenEvent> =>
  postToGas<RedrivenEvent>(`${toPath(key)}/redrive`, { actor })

/**
 * The dead letters on this page's filters, grouped by the failure that caused
 * them — the shape the time-ordered list cannot show. Dead letters only, and
 * never more than twenty groups, count descending. The `error` on a group
 * travels back verbatim as `?error=` and is the whole message, not a prefix.
 */
export interface EventBreakdownGroup {
  /** The whole `lastError.message`, or null for the ones that recorded none. */
  error: string | null
  /**
   * The short type the rows in this group share — `audit` for the records
   * that are not CloudEvents — so a group and the rows it counts read the
   * same.
   */
  type: string
  count: number
  firstAt: string
  lastAt: string
}

export interface EventBreakdownPage {
  groups: EventBreakdownGroup[]
  sourceErrors: SourceError[]
}
