import { getFromGas } from '../../common/gas.ts'

export type EventService = 'gas' | 'caseworking'
export type EventBox = 'inbox' | 'outbox'

/**
 * The six statuses both services write today. `Event.status` is a plain string,
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

/** One inbox or outbox row, generic message plumbing only — never payload. */
export interface Event {
  service: EventService
  box: EventBox
  id: string
  eventId: string
  /** Short type, or `audit · APPLICATION.CREATE` for an audit row, or `-`. */
  type: string
  /** The un-stripped CloudEvent type; null for an audit row. */
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
 * The four parameters the page and the endpoint share, as plain strings. The
 * page does not police the enums — GAS owns them, answers 400 for a value it
 * does not know, and that 400 surfaces as this page's error alert. Validating
 * here would instead hand the user the shared govuk error page.
 */
export interface EventsQuery {
  cursor?: string
  direction?: string
  status?: string
  service?: string
}

const toSearch = (query: EventsQuery): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined)
  )

  return params.size ? `?${params}` : ''
}

export const findEvents = async (query: EventsQuery): Promise<EventsPage> =>
  getFromGas<EventsPage>(`/grant-admin/events${toSearch(query)}`)
