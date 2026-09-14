import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  EventBreakdownPage,
  EventFacets,
  EventsPage,
  EventsQuery,
  ServiceFilter,
  StatusFilter
} from '../repositories/events.repository.ts'
import { findEventsPage } from '../repositories/events.repository.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { toGasStatusCode } from './gas-status.ts'
import { logSectionErrors } from './section-errors.ts'

export type {
  Event,
  EventBox,
  EventBreakdownGroup,
  EventBreakdownPage,
  EventCounts,
  EventFacets,
  EventKey,
  EventLastError,
  EventRow,
  EventService,
  EventsPage,
  EventsPagination,
  EventsQuery,
  SectionError,
  ServiceFilter,
  SourceError,
  StatusFilter
} from '../repositories/events.repository.ts'

export interface EventsResult {
  page: EventsPage
  statuses: StatusFilter[]
  services: ServiceFilter[]
  facets: EventFacets | null
  breakdown: EventBreakdownPage | null
  unavailable: boolean
  refused?: boolean
}

const noPage: EventsPage = {
  events: [],
  pagination: {
    endCursor: null,
    hasNextPage: false
  },
  sourceErrors: []
}

// A 400 only: every other status is an outage, not a bad link.
const isRefusal = (error: unknown): boolean =>
  toGasStatusCode(error) === statusCodes.badRequest

const logFailure = (refused: boolean, error: unknown): void => {
  if (refused) {
    logger.warn(
      `fg-gas-backend refused the events page parameters: ${describeError(error)}`
    )

    return
  }

  logger.error(
    `Could not read the events page from fg-gas-backend: ${describeError(error)}`
  )
}

export const getEventsUseCase = async (
  query: EventsQuery
): Promise<EventsResult> => {
  try {
    const {
      events,
      pagination,
      sourceErrors,
      statuses,
      services,
      counts,
      breakdown,
      sectionErrors
    } = await findEventsPage(query)

    logSectionErrors('the events page', sectionErrors)

    return {
      page: { events, pagination, sourceErrors },
      statuses,
      services,
      facets: counts === null ? null : { counts },
      breakdown,
      unavailable: false
    }
  } catch (error) {
    const refused = isRefusal(error)

    logFailure(refused, error)

    return {
      page: noPage,
      statuses: [],
      services: [],
      facets: null,
      breakdown: null,
      unavailable: !refused,
      refused
    }
  }
}
