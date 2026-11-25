import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { findEventStatus } from '../repositories/events.repository.ts'
import { isSettledStatus } from './event-state.ts'

/** What a page watching a redrive needs: whether it has settled, and how far the retries have got. */
export interface EventCheck {
  settled: boolean
  failed: number
  allowed: number
}

/** A check that fails is no answer: the page asks again, and says nothing of it. */
export const getEventStatusUseCase = async (
  key: EventKey
): Promise<EventCheck | null> => {
  try {
    const { status, attemptsSinceRedrive, maxAttempts } =
      await findEventStatus(key)

    return {
      settled: isSettledStatus(status),
      failed: attemptsSinceRedrive,
      allowed: maxAttempts
    }
  } catch (error) {
    logger.warn(
      `Could not read the status of event ${key.service}/${key.box}/${key.id} from fg-gas-backend: ${describeError(error)}`
    )

    return null
  }
}
