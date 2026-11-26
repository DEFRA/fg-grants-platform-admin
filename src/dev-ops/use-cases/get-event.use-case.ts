import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { isUnanswered, toGasFailure, toGasStatusCode } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  BadgeRole,
  EventAttempt,
  EventBox,
  EventDetail,
  EventHistoryEntry,
  EventKey,
  EventLastEdit,
  EventLastRedrive,
  EventRecord,
  EventRow,
  EventService,
  SourceError
} from '../repositories/events.repository.ts'

/** How a read that failed failed, so the page can name the service it is down to. */
export type EventResult =
  | { outcome: 'found'; event: EventDetail; failure: null }
  | { outcome: 'not-found'; event: null; failure: null }
  | { outcome: 'timed-out' | 'unavailable'; event: null; failure: GasFailure }

const notFound: EventResult = {
  outcome: 'not-found',
  event: null,
  failure: null
}

const toFailed = (failure: GasFailure): EventResult => ({
  outcome: isUnanswered(failure) ? 'timed-out' : 'unavailable',
  event: null,
  failure
})

export const getEventUseCase = async (key: EventKey): Promise<EventResult> => {
  try {
    return { outcome: 'found', event: await findEvent(key), failure: null }
  } catch (error) {
    const where = `${key.service}/${key.box}/${key.id}`

    if (toGasStatusCode(error) === statusCodes.notFound) {
      logger.info(`No event ${where} in fg-gas-backend`)

      return notFound
    }

    logger.error(
      `Could not read event ${where} from fg-gas-backend: ${describeError(error)}`
    )

    return toFailed(toGasFailure(error))
  }
}
