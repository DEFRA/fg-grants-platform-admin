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
import { showsDeadLetterContent } from './dead-letter-page.ts'
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
  /**
   * The vocabulary the status tiles and the service menu are labelled and
   * explained with, from the endpoint. Empty only on the page that could not
   * be read at all, which has nothing to label.
   */
  statuses: StatusFilter[]
  services: ServiceFilter[]
  /**
   * Every figure the status tiles carry. Null when that read failed on its
   * own, which is not an outage: the page still has its rows, and the tiles
   * simply render without figures.
   */
  facets: EventFacets | null
  /**
   * The dead letters behind the current filters, grouped by the failure that
   * caused them. Null when the read failed, and null when the page could not
   * have drawn the panel anyway — the panel is only about dead letters, so a
   * page filtered to Completed never asks the question.
   */
  breakdown: EventBreakdownPage | null
  /**
   * The whole read failed — distinct from a page that is merely missing a
   * source, which the endpoint reports as `page.sourceErrors` with a 200.
   */
  unavailable: boolean
  /**
   * The endpoint's own validation rejected the query — a hand-edited cursor, a
   * range it will not take. A 400 and only a 400: the page says so rather than
   * painting an outage, because an operator opened it to find out whether the
   * estate is down, and telling them it is when their own link is the problem
   * is the one answer worse than no answer. The reverse mistake is just as
   * bad, which is why a 401, 403, 404 or 429 is NOT this.
   */
  refused?: boolean
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
 * The events page, in one read: fg-gas-backend composes it and this app
 * renders it. The two aggregations come back null when they failed on their
 * own — a page with rows and no figures is still a page — and a failure of
 * the rows themselves is the one state painted as an outage.
 *
 * The panel's rule stays here because it is about what this page draws: the
 * breakdown is about dead letters, so a page narrowed to any other status
 * ignores it.
 */
// A 400 and nothing else: that is the status fg-gas-backend answers when its
// own route validation rejects the query, which is the one case where the
// parameters really are the problem (its `failAction` rethrows the Joi error,
// and hapi renders that as a 400).
//
// Deliberately not "any 4xx". A 401 or 403 is this app's credential, a 404 is a
// route that moved, a 429 is the endpoint asking us to slow down - every one of
// them is an operational failure the operator can do nothing about by editing
// the link, and telling them their parameters were refused would send them
// hunting for a typo that is not there.
const isRefusal = (error: unknown): boolean =>
  toGasStatusCode(error) === statusCodes.badRequest

// A refused link is worth a line and not an alert; anything else is the
// outage this page exists to show.
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
      // The filters' words go straight through: a constant of the endpoint, not
      // a section that can fail, so there is no null to degrade around.
      statuses,
      services,
      facets: counts === null ? null : { counts },
      breakdown: showsDeadLetterContent(query) ? breakdown : null,
      unavailable: false
    }
  } catch (error) {
    // A 400 is this link, not this platform.
    //
    // The enums are validated at the route precisely so a typo is not reported
    // as an outage - but a hand-edited `?cursor=` or a `?from=` that parses
    // here and not there still comes back 400, and painting that as "Events
    // could not be loaded from GAS" tells an operator the estate is down on
    // the very page they opened to find out whether it is. Every other status
    // means the opposite, and says so.
    const refused = isRefusal(error)

    logFailure(refused, error)

    return {
      page: noPage,
      // A page that could not be read has no statuses or services to offer,
      // so the vocabulary is empty rather than invented here.
      statuses: [],
      services: [],
      facets: null,
      breakdown: null,
      unavailable: !refused,
      refused
    }
  }
}
