import {
  isCompletedStatus,
  isInFlightStatus
} from '../use-cases/event-state.ts'
import type {
  GrantVersionEvents,
  RecordEvents,
  VersionEvents
} from '../use-cases/record-reads.ts'
import type { SourceError } from '../repositories/events.repository.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import { toEventHref } from './event-formats.ts'
import { backKey } from './bucket-links.ts'
import { toFailureText } from './failure-text.ts'
import { toFittingBack } from './record-filters.ts'
import { msPerDay } from './zoned-clock.ts'

/**
 * The version's Details row for the ConfigVersionUpdated event it arrived as.
 * GAS and CW keep no event ID on a version, so the page reads the version's
 * events from the inbox and links the newest that completed. A version exists
 * only because its event arrived, so an inbox read whole that holds none of a
 * version past its retention means it is past its deletion date. Retire this once the version header carries its event's ID (DATA-GAPS 6).
 */
export type VersionEvent =
  | { kind: 'held'; eventId: string; href: string }
  | { kind: 'gone'; text: string }
  | { kind: 'none'; text: string }
  | { kind: 'unread'; text: string }

/** How long CW keeps a completed event unless its EVENT_RETENTION_DAYS says otherwise. Moves to CW, as GAS's did. */
const keptDays = 90

const keptMs = keptDays * msPerDay

/** When the version arrived, and the time it is now. */
export interface Received {
  receivedAt: string
  now: Date
}

type EventRow = RecordEvents['rows'][number]

/**
 * The newest that completed; else the newest still on its way to completing,
 * as the version is written before its event is marked Completed. A failed
 * delivery is never the event the version arrived as.
 */
const pickEvent = ({ rows }: RecordEvents): EventRow | undefined =>
  rows.find(({ status }) => isCompletedStatus(status)) ??
  rows.find(({ status }) => isInFlightStatus(status))

const toHeld = (event: EventRow, back: string): VersionEvent => ({
  kind: 'held',
  eventId: event.eventId,
  href: `${toEventHref(event)}?${backKey}=${encodeURIComponent(toFittingBack(back))}`
})

const isPastKept = ({ receivedAt, now }: Received): boolean =>
  now.getTime() - Date.parse(receivedAt) > keptMs

/** Past its deletion date only when the inbox was read whole, holds none of the version's events, and the version is past its retention. */
const toNoneHeld = (
  { rows, more }: RecordEvents,
  source: string,
  pastDeletion: boolean
): VersionEvent => {
  if (more) {
    return {
      kind: 'unread',
      text: `Not among the newest events in ${source}’s inbox.`
    }
  }

  if (rows.length) {
    return {
      kind: 'none',
      text: `Only failed deliveries in ${source}’s inbox.`
    }
  }

  return pastDeletion
    ? { kind: 'gone', text: 'No longer held: past its deletion date' }
    : { kind: 'none', text: `No event found in ${source}’s inbox.` }
}

const unreadText = (source: string) =>
  `Couldn’t be read from ${source}’s inbox.`

const unread = (source: string, failure: GasFailure): VersionEvent => ({
  kind: 'unread',
  text: `${unreadText(source)} ${toFailureText(failure, source)}`
})

/** CW-BE is GAS not reaching CW at all; any other hop is a source GAS failed to read. */
const toSourceFailure = ([{ hop }]: SourceError[]): GasFailure =>
  hop === 'CW-BE' ? { kind: 'cw-not-reached' } : { kind: 'errored' }

/** GAS gave up on the inbox within its time limit, or failed to read it. */
const unreadFailures: Record<
  Exclude<VersionEvents['outcome'], 'read'>,
  GasFailure
> = {
  'timed-out': { kind: 'timed-out' },
  failed: { kind: 'errored' }
}

/** An inbox GAS couldn't read answers no rows and the hop in `sourceErrors`: that is unread, never empty. */
const fromRead = (
  { events, sourceErrors }: Extract<VersionEvents, { outcome: 'read' }>,
  source: string,
  back: string,
  pastDeletion: boolean
): VersionEvent => {
  if (sourceErrors.length) {
    return unread(source, toSourceFailure(sourceErrors))
  }

  const event = pickEvent(events)

  return event ? toHeld(event, back) : toNoneHeld(events, source, pastDeletion)
}

const toVersionEvent = <Events extends VersionEvents>(
  events: Events | undefined,
  source: string,
  back: string,
  isPastDeletion: (read: Extract<Events, { outcome: 'read' }>) => boolean
): VersionEvent => {
  if (!events) {
    return { kind: 'unread', text: unreadText(source) }
  }

  if (events.outcome !== 'read') {
    return unread(source, unreadFailures[events.outcome])
  }

  const read = events as Extract<Events, { outcome: 'read' }>

  return fromRead(read, source, back, isPastDeletion(read))
}

/** @param events Newest first, or why GAS's inbox couldn't be read. @param back This page, where the event page leads back to. */
export const toGrantVersionEvent = (
  events: GrantVersionEvents | undefined,
  back: string
): VersionEvent =>
  toVersionEvent(events, 'GAS', back, ({ pastDeletion }) => pastDeletion)

/** @param events Newest first, or why CW's inbox couldn't be read. @param back This page, where the event page leads back to. */
export const toWorkflowVersionEvent = (
  events: VersionEvents | undefined,
  back: string,
  received: Received
): VersionEvent =>
  toVersionEvent(events, 'CW', back, () => isPastKept(received))
