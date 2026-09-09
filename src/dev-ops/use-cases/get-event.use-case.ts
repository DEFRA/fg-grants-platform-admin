import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventDetail,
  EventKey,
  JourneyHop
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { toGasStatusCode } from './gas-status.ts'
import { logSectionErrors } from './section-errors.ts'

export type {
  EventDetail,
  EventKey,
  JourneyHop
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
   * not be read, and empty when the endpoint could not read the journey — one
   * section the page cannot draw is not worth losing the event over.
   */
  journey: JourneyHop[]
}

const notFound: EventResult = {
  outcome: 'not-found',
  event: null,
  journey: []
}
const unavailable: EventResult = {
  outcome: 'unavailable',
  event: null,
  journey: []
}

/**
 * One event, its journey, or an honest reason there is neither. A journey the
 * endpoint could not read comes back null and is drawn as an empty table: the
 * event is on the page, and one section of it is not worth losing the page
 * over.
 */
export const getEventUseCase = async (key: EventKey): Promise<EventResult> => {
  try {
    const { journey, sectionErrors, ...event } = await findEvent(key)

    logSectionErrors(`event ${key.service}/${key.box}/${key.id}`, sectionErrors)

    return { outcome: 'found', event, journey: journey ?? [] }
  } catch (error) {
    const where = `${key.service}/${key.box}/${key.id}`

    // A 404 is an operator following a stale link, which is ordinary use of
    // this page and not an error anybody should be paged about. `error` is
    // kept for the states that mean something is actually wrong, so the
    // dashboards this page exists to support are not filled by it.
    if (toGasStatusCode(error) === statusCodes.notFound) {
      logger.info(`No event ${where} in fg-gas-backend`)

      return notFound
    }

    logger.error(
      `Could not read event ${where} from fg-gas-backend: ${describeError(error)}`
    )

    return unavailable
  }
}
