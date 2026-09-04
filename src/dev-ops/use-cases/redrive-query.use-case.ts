import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  RedriveQueryQuery,
  RedriveQueryResult
} from '../repositories/events.repository.ts'
import { redriveByQuery } from '../repositories/events.repository.ts'

export type {
  RedriveQueryQuery,
  RedriveQueryResult,
  RedriveQuerySource
} from '../repositories/events.repository.ts'

export interface RedriveQueryOutcome {
  /** What the backend did, or null when it could not be asked at all. */
  result: RedriveQueryResult | null
  unavailable: boolean
}

/**
 * Redrives every dead letter behind the current filters.
 *
 * The batch redrive was twenty ticked boxes, which is the right size for "these
 * eight, not those" and the wrong size for a queue with seven thousand copies
 * of one failure in it. This is the other shape of the same intent: the
 * operator narrows the list until it is exactly what they mean, and the write
 * takes the filters rather than the ids.
 *
 * One read, not a loop: the backend does the fan-out, applies its own cap and
 * reports what it managed. This app deliberately does not page through and call
 * again — a client that retried the write until `processed` reached `matched`
 * would be a client hammering a queue that is already having a bad day, and the
 * decision to run it again belongs to the person watching.
 *
 * A failure here is not a partial write to be recovered: the backend either
 * answered with its five figures or it did not, and the page says which.
 */
export const redriveQueryUseCase = async (
  query: RedriveQueryQuery,
  actor?: string
): Promise<RedriveQueryOutcome> => {
  try {
    return { result: await redriveByQuery(query, actor), unavailable: false }
  } catch (error) {
    logger.error(
      `Could not redrive events by query in fg-gas-backend: ${describeError(error)}`
    )

    return { result: null, unavailable: true }
  }
}
