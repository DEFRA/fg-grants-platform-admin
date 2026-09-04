import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  EventBreakdownPage,
  EventCountsQuery,
  EventFacets,
  EventsPage,
  EventsQuery
} from '../repositories/events.repository.ts'
import {
  findEventBreakdown,
  findEventCounts,
  findEvents
} from '../repositories/events.repository.ts'

export type {
  Event,
  EventBox,
  EventBreakdownGroup,
  EventBreakdownPage,
  EventBreakdownQuery,
  EventCounts,
  EventCountsQuery,
  EventFacets,
  EventLastError,
  EventParked,
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
   * Every figure the toolbar's segments are labelled with: how many events are
   * in each state across the whole set the filters describe, and how that same
   * set divides by service. Null when that read failed on its own,
   * which is not an outage: the page still has its rows, and the segments
   * simply render as the labels they were before the endpoint existed.
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
 * The rows, or an honest empty page.
 *
 * Every failure the endpoint can answer with is the same fact to this page: it
 * could not be read. A 400 for a query GAS does not accept, a 400 for a
 * tampered cursor, a 401 for an expired service token, a 502 for both GAS
 * reads down, a timeout — all render the page with one alert on it, rather
 * than the shared error page taking over a screen an operator opened
 * precisely because something is broken.
 */
const readPage = async (
  query: EventsQuery
): Promise<{ page: EventsPage; unavailable: boolean }> => {
  try {
    return { page: await findEvents(query), unavailable: false }
  } catch (error) {
    logger.error(
      `Could not read events from fg-gas-backend: ${describeError(error)}`
    )

    return { page: noPage, unavailable: true }
  }
}

/**
 * The dataset-wide facets, or nothing at all.
 *
 * A failed count is deliberately quieter than a failed page. The figures it
 * feeds are labels on controls that work perfectly well without them, and a
 * table that rendered has not become an error because the numbers above it
 * could not be read — so this answers null and the segments go back to being
 * the words they always were.
 *
 * `sourceErrors` is dropped: the list read reports the same partial sources on
 * `page.sourceErrors`, and one alert saying it once is the whole of what the
 * page has to say about a source that did not answer.
 */
const readCounts = async (query: EventsQuery): Promise<EventFacets | null> => {
  const { service, q, from, to, error: message } = query

  try {
    const { counts } = await findEventCounts({
      service,
      q,
      from,
      to,
      error: message
    })

    return { counts }
  } catch (error) {
    logger.error(
      `Could not read event counts from fg-gas-backend: ${describeError(error)}`
    )

    return null
  }
}

/**
 * Whether the page could show a failure breakdown at all.
 *
 * The panel is about dead letters and nothing else, so a page narrowed to
 * Completed — or to any other status — has no question for this endpoint to
 * answer, and asking it anyway would be a third read on every page load for a
 * panel that could never be drawn. A page with no status filter still asks:
 * whether it draws the panel then depends on whether there are any dead
 * letters at all, and that is a fact the facets carry, not this query.
 */
const asksForBreakdown = ({ status }: EventsQuery): boolean =>
  !status || status === 'DEAD_LETTER'

/**
 * The failure breakdown, or nothing at all.
 *
 * Quieter than a failed count, for the same reason and one more: the panel is
 * an aid to triage sitting above a table that works perfectly well without it,
 * so a breakdown that could not be read is a page with no panel on it and no
 * alert about one either. An operator who came here to redrive something is not
 * helped by being told that a summary failed.
 */
const readBreakdown = async (
  query: EventsQuery
): Promise<EventBreakdownPage | null> => {
  if (!asksForBreakdown(query)) {
    return null
  }

  const { service, q, from, to } = query

  try {
    return await findEventBreakdown({ service, q, from, to })
  } catch (error) {
    logger.error(
      `Could not read the event breakdown from fg-gas-backend: ${describeError(error)}`
    )

    return null
  }
}

/**
 * The dataset-wide breakdown on its own, for the page that has to quote a
 * figure before it writes: `Redrive all 7,064 matching` is a promise about the
 * same filters the list was read under, and the confirmation that quotes it
 * reads them itself rather than trusting a number handed to it on a url.
 */
export const getEventCountsUseCase = async (
  query: EventCountsQuery
): Promise<EventFacets | null> => readCounts(query)

/**
 * The events page: the rows and the counts above them, read together.
 *
 * Three reads rather than one, in parallel, because they answer three
 * different questions — this window of the stream, the size of the set it is a
 * window into, and the shape of the failures inside it — and none is worth
 * waiting for another. Each can fail on its own without taking the others down
 * with it.
 */
export const getEventsUseCase = async (
  query: EventsQuery
): Promise<EventsResult> => {
  const [{ page, unavailable }, facets, breakdown] = await Promise.all([
    readPage(query),
    readCounts(query),
    readBreakdown(query)
  ])

  return { page, facets, breakdown, unavailable }
}
