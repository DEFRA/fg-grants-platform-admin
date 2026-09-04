import type { BatchEvent } from '../use-cases/get-batch-events.use-case.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import type { RedriveBatchItem } from '../use-cases/redrive-event.use-case.ts'
import type { BadgeRole } from './event-formats.ts'
import {
  toEventHref,
  toQueue,
  toSourceName,
  toStatusBadge,
  toStatusLabel
} from './event-formats.ts'

/**
 * The two pages a bulk redrive is made of: what is about to happen, and what
 * happened.
 *
 * Both are lists of the same rows said two ways, so both are built here. A
 * batch write with no confirmation is a mis-click that queues twenty messages,
 * and a batch write with no result page is twenty writes an operator has to go
 * and check one at a time — the flow only works if both ends of it name every
 * event by something a human recognises rather than by an ObjectId.
 */

/** A `—`, said the same way everywhere a value is simply not there. */
const none = '—'

/** One selected event on the confirmation, named the way the list names it. */
export interface ConfirmRow {
  /** The key as the form carries it, straight back out as a hidden field. */
  value: string
  /**
   * The type, drawn UNDER the id as the secondary half of the identity. Null on
   * a row that stores none — an audit record is not a CloudEvent — and a dash
   * on a row that could not be read at all, which are two different facts: the
   * first draws no type line, the second says it could not be read.
   */
  type: string | null
  eventId: string
  /** `GAS · Outbox` — which hop of the journey this row is. */
  source: string
  /**
   * What it travelled on, said as the list says it: the whole topic on an
   * outbox row, `from GAS` on an inbox one. A dash on a row we could not read.
   */
  queue: string
  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  /** This row's own page, for an operator who wants to check one of them. */
  href: string
  /**
   * Whether the event could be read at all. A row that could not be is still
   * listed and still redriven — the write is by address, not by what we
   * managed to display — but it says so rather than showing a line of dashes
   * an operator would read as a bug.
   */
  found: boolean
}

export interface RedriveConfirmModel {
  rows: ConfirmRow[]
  count: number
  /** Where the confirmation posts: this same route, with `?confirmed=1`. */
  action: string
  /** The list's own query, carried through both stages and back out again. */
  from: string
  backHref: string
}

/** One event's outcome, as the results page says it. */
export interface ResultRow {
  eventId: string
  source: string
  href: string
  /** `Resubmitted`, `Conflict (Completed)`, `Not found`, `Error`. */
  outcome: string
  outcomeRole: BadgeRole
  /** One line saying what that outcome means for this event. */
  detail: string
}

export interface RedriveResultsModel {
  rows: ResultRow[]
  count: number
  /** How many of them were actually put back on the queue. */
  redrivenCount: number
  backHref: string
}

/**
 * The queue on one line, in the list's own vocabulary — the operator is
 * checking that these are the rows they ticked, and a second spelling of the
 * column they ticked them in is a second thing to reconcile. The confirmation
 * has no column widths to fight, so it is drawn whole either way.
 */
const toQueueLine = (event: BatchEvent['event']): string =>
  event === null ? none : (toQueue(event).queue ?? none)

/** The address as the form spells it, so stage two selects what stage one did. */
const toValue = ({ service, box, id }: EventKey): string =>
  `${service}:${box}:${id}`

/**
 * A row we could read: named by its type, its reference and where it is going,
 * which is what an operator actually recognises a selection by.
 */
const toFoundRow = (
  key: EventKey,
  event: NonNullable<BatchEvent['event']>
): ConfirmRow => {
  const badge = toStatusBadge(event.status)

  return {
    value: toValue(key),
    type: event.type,
    eventId: event.eventId,
    source: toSourceName(key),
    queue: toQueueLine(event),
    status: event.status,
    statusLabel: toStatusLabel(event.status),
    statusRole: badge.role,
    statusRetrying: badge.retrying,
    href: toEventHref(key),
    found: true
  }
}

/**
 * A row we could not. It is still listed and still redriven — the write is by
 * address, and dropping it would take an event off a confirmation the operator
 * is reading precisely to check what they selected — but it is drawn as
 * unknown rather than as a line of dashes anyone would read as a bug. The
 * address stands in for every name it does not have.
 */
const toMissingRow = (key: EventKey): ConfirmRow => ({
  value: toValue(key),
  type: none,
  eventId: key.id,
  source: toSourceName(key),
  queue: none,
  status: '',
  statusLabel: 'Unknown',
  statusRole: 'neutral',
  statusRetrying: false,
  href: toEventHref(key),
  found: false
})

const toConfirmRow = ({ key, event }: BatchEvent): ConfirmRow =>
  event === null ? toMissingRow(key) : toFoundRow(key, event)

export const toRedriveConfirm = (
  events: BatchEvent[],
  from: string
): RedriveConfirmModel => ({
  rows: events.map(toConfirmRow),
  count: events.length,
  action: '/dev-ops/events/redrive-batch?confirmed=1',
  from,
  backHref: `/dev-ops/events${from}`
})

/**
 * The four things a redrive can come to, in the words the inspect page already
 * uses for them. A conflict names the status that refused it, because "it did
 * not work" is a useless sentence next to "it is Completed already".
 */
const outcomes: Record<
  string,
  { label: string; role: BadgeRole; detail: string }
> = {
  redriven: {
    label: 'Resubmitted',
    role: 'success',
    detail: 'Back on the queue — the poller will retry it.'
  },
  conflict: {
    label: 'Conflict',
    role: 'warning',
    detail: 'Not redriven — this event is no longer dead-lettered.'
  },
  'not-found': {
    label: 'Not found',
    role: 'error',
    detail: 'Not redriven — fg-gas-backend no longer has this event.'
  },
  unavailable: {
    label: 'Error',
    role: 'error',
    detail: 'Not redriven — fg-gas-backend could not be reached.'
  }
}

const toResultRow = ({ key, result }: RedriveBatchItem): ResultRow => {
  const outcome = outcomes[result.outcome]
  const status = result.status === null ? null : toStatusLabel(result.status)

  return {
    eventId: key.id,
    source: toSourceName(key),
    href: toEventHref(key),
    outcome: status === null ? outcome.label : `${outcome.label} (${status})`,
    outcomeRole: outcome.role,
    detail:
      status === null
        ? outcome.detail
        : `${outcome.detail} Its status is now ${status}.`
  }
}

export const toRedriveResults = (
  items: RedriveBatchItem[],
  from: string
): RedriveResultsModel => ({
  rows: items.map(toResultRow),
  count: items.length,
  redrivenCount: items.filter(({ result }) => result.outcome === 'redriven')
    .length,
  backHref: `/dev-ops/events${from}`
})
