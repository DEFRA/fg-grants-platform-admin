import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  EventsPage,
  EventsQuery
} from '../repositories/events.repository.ts'
import { findEvents } from '../repositories/events.repository.ts'

export type {
  Event,
  EventBox,
  EventService,
  EventsPage,
  EventsPagination,
  EventsQuery,
  KnownEventStatus,
  SourceError
} from '../repositories/events.repository.ts'

export interface EventsResult {
  page: EventsPage
  /**
   * The whole read failed — distinct from a page that is merely missing a
   * source, which the endpoint reports as `page.sourceErrors` with a 200.
   */
  unavailable: boolean
}

const noPage: EventsPage = {
  events: [],
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false
  },
  sourceErrors: []
}

/**
 * The events page, or an honest empty one.
 *
 * Every failure the endpoint can answer with is the same fact to this page: it
 * could not be read. A 400 for a query GAS does not accept, a 400 for a
 * tampered cursor, a 401 for an expired service token, a 502 for both GAS
 * reads down, a timeout — all render the page with one alert on it, rather
 * than the shared error page taking over a screen an operator opened
 * precisely because something is broken.
 */
export const getEventsUseCase = async (
  query: EventsQuery
): Promise<EventsResult> => {
  try {
    return { page: await findEvents(query), unavailable: false }
  } catch (error) {
    logger.error(
      `Could not read events from fg-gas-backend: ${describeError(error)}`
    )

    return { page: noPage, unavailable: true }
  }
}
