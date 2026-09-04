import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { redriveEvent } from '../repositories/events.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

/**
 * What came of asking for a redrive, in the four words the page has to say.
 *
 * `conflict` is the interesting one: the endpoint refuses a redrive for an
 * event that is no longer dead-lettered, which is exactly what happens when
 * two operators are looking at the same row, or when one of them left the tab
 * open while the poller moved on. It is not a failure — the event is fine, and
 * the page has to say which state it is actually in.
 */
export type RedriveOutcome =
  | 'redriven'
  | 'conflict'
  | 'not-found'
  | 'unavailable'

export interface RedriveResult {
  outcome: RedriveOutcome
  /** The status the event is in now. Only a conflict reports one. */
  status: string | null
}

const toOutcome = (error: unknown): RedriveResult => {
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
 * Puts one event back on the queue, and reports what the backend made of it.
 *
 * `actor` is who asked, as the route read them off the session. It travels to
 * the backend on `x-actor` so the audit record names a person rather than this
 * app's service token, and it is passed rather than derived here because a use
 * case has no request to read it from.
 *
 * The row the endpoint answers with is deliberately dropped. The page redirects
 * after a write rather than rendering the response — a reload must not
 * re-submit a redrive — so the fresh row is read again by the page that follows,
 * and returning it here would only invite a second source of truth.
 */
export const redriveEventUseCase = async (
  key: EventKey,
  actor?: string
): Promise<RedriveResult> => {
  try {
    await redriveEvent(key, actor)

    return { outcome: 'redriven', status: null }
  } catch (error) {
    logger.error(
      `Could not redrive event ${key.service}/${key.box}/${key.id} in fg-gas-backend: ${describeError(error)}`
    )

    return toOutcome(error)
  }
}
