import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'

export type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'

/** One selected event, as far as it could be read. */
export interface BatchEvent {
  key: EventKey
  /** Null when that one read failed — a row the page draws as unknown. */
  event: EventDetail | null
}

/**
 * The events a batch is about to act on, read one at a time.
 *
 * The confirmation is the whole safety of a bulk write: an operator who ticked
 * eight boxes on a scrolling table has to see what they actually selected
 * before anything is queued, and `8 events` is not that — a list of types and
 * references is. So each one is read, and a read that fails is drawn as a row
 * that could not be read rather than dropped, because a row silently missing
 * from a confirmation is a row nobody notices they are about to redrive.
 *
 * Sequential on purpose. Twenty parallel reads of a service already having a
 * bad day is a burst this page has no business making, and the operator is
 * confirming something either way.
 */
export const getBatchEventsUseCase = async (
  keys: EventKey[]
): Promise<BatchEvent[]> => {
  const events: BatchEvent[] = []

  for (const key of keys) {
    events.push({ key, event: await readEvent(key) })
  }

  return events
}

const readEvent = async (key: EventKey): Promise<EventDetail | null> => {
  try {
    return await findEvent(key)
  } catch (error) {
    logger.error(
      `Could not read event ${key.service}/${key.box}/${key.id} from fg-gas-backend: ${describeError(error)}`
    )

    return null
  }
}
