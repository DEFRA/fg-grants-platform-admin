import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  Event,
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import { findEvent, findEvents } from '../repositories/events.repository.ts'
import { toGasStatusCode } from './gas-status.ts'

export type {
  Event,
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'

/**
 * The three answers this page has. A 404 is a page of its own — the operator
 * followed a stale link, or typed an id that does not exist, and neither is an
 * error worth a red screen. Everything else that failed is "could not be
 * read", exactly as the list page treats it.
 */
export type EventOutcome = 'found' | 'not-found' | 'unavailable'

export interface EventResult {
  outcome: EventOutcome
  event: EventDetail | null
  /**
   * Every hop carrying this event id, newest first, as the list endpoint
   * returns them: the inbox row that received it, the outbox row that
   * published it, the retry that followed. Empty when the event itself could
   * not be read, and empty when only the journey read failed — one hop the
   * page cannot draw is not worth losing the event over.
   */
  journey: Event[]
}

const notFound: EventResult = { outcome: 'not-found', event: null, journey: [] }
const unavailable: EventResult = {
  outcome: 'unavailable',
  event: null,
  journey: []
}

/**
 * The other rows this message wrote, asked for by its event id and nothing
 * else. It is the same question the id on the list already links at, answered
 * on the page rather than one navigation away, so an operator holding a dead
 * letter can see the hop it came from without leaving the row.
 *
 * A journey that cannot be read is not an error: the event is on the page and
 * the table simply is not.
 */
const readJourney = async (eventId: string): Promise<Event[]> => {
  try {
    const { events } = await findEvents({ q: eventId })

    return events
  } catch (error) {
    logger.error(
      `Could not read the journey for event ${eventId} from fg-gas-backend: ${describeError(error)}`
    )

    return []
  }
}

/** One event, its journey, or an honest reason there is neither. */
export const getEventUseCase = async (key: EventKey): Promise<EventResult> => {
  let event: EventDetail

  try {
    event = await findEvent(key)
  } catch (error) {
    logger.error(
      `Could not read event ${key.service}/${key.box}/${key.id} from fg-gas-backend: ${describeError(error)}`
    )

    return toGasStatusCode(error) === statusCodes.notFound
      ? notFound
      : unavailable
  }

  return {
    outcome: 'found',
    event,
    journey: await readJourney(event.eventId)
  }
}
