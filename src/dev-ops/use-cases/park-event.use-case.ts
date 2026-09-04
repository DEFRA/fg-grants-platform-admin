import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { parkEvent, unparkEvent } from '../repositories/events.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

/**
 * Parking is the other half of the redrive.
 *
 * A dead letter is a decision waiting to be made, and until now the page
 * offered exactly one way to make it: put the message back on the queue. Most
 * of a real dead-letter queue is not that. It is four hundred copies of one
 * failure that will fail again until somebody fixes a topic ARN, and an
 * operator triaging it needs a way to say "we have seen this one, leave it" —
 * out of the count, out of the way, with the reason written down for whoever
 * looks next.
 *
 * The four outcomes are the redrive's own, and deliberately so: the two writes
 * refuse for the same reasons, the pages say them in the same words, and an
 * operator meeting a conflict on a park should not have to learn a second
 * vocabulary for the same fact.
 */
export type ParkOutcome = 'parked' | 'conflict' | 'not-found' | 'unavailable'

export interface ParkResult {
  outcome: ParkOutcome
  /** The status the event is in now. Only a conflict reports one. */
  status: string | null
}

const toOutcome = (error: unknown): ParkResult => {
  const statusCode = toGasStatusCode(error)

  if (statusCode === statusCodes.conflict) {
    return { outcome: 'conflict', status: toGasErrorField(error, 'status') }
  }

  return {
    outcome: statusCode === statusCodes.notFound ? 'not-found' : 'unavailable',
    status: null
  }
}

/**
 * Sets one event aside, with the reason the operator typed.
 *
 * The reason is required by the form and by the backend, and it is the whole
 * point of the action: a parked event with no reason is an event that has
 * silently left the count, which is worse than one nobody parked at all.
 *
 * The row the endpoint answers with is dropped for the same reason a redrive's
 * is: the page redirects after the write, and the page that lands reads the
 * event again rather than rendering a copy that arrived on the response to a
 * POST.
 */
export const parkEventUseCase = async (
  key: EventKey,
  reason: string,
  actor?: string
): Promise<ParkResult> => {
  try {
    await parkEvent(key, reason, actor)

    return { outcome: 'parked', status: null }
  } catch (error) {
    logger.error(
      `Could not park event ${key.service}/${key.box}/${key.id} in fg-gas-backend: ${describeError(error)}`
    )

    return toOutcome(error)
  }
}

/**
 * Puts a parked event back among the dead letters.
 *
 * The way out of a park, and the reason a park is safe to offer: nothing about
 * it is final, and an operator who set aside the wrong thing — or who parked
 * four hundred events behind a cause that has since been fixed — undoes it
 * from the same page they did it on.
 */
export const unparkEventUseCase = async (
  key: EventKey,
  actor?: string
): Promise<ParkResult> => {
  try {
    await unparkEvent(key, actor)

    return { outcome: 'parked', status: null }
  } catch (error) {
    logger.error(
      `Could not unpark event ${key.service}/${key.box}/${key.id} in fg-gas-backend: ${describeError(error)}`
    )

    return toOutcome(error)
  }
}
