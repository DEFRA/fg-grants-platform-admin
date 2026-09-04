import { logger } from '../../common/logger.ts'
import type {
  EventCounts,
  EventFacets,
  EventsPage
} from '../repositories/events.repository.ts'
import {
  findEventBreakdown,
  findEventCounts,
  findEvents
} from '../repositories/events.repository.ts'
import {
  getEventCountsUseCase,
  getEventsUseCase
} from './get-events.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const page: EventsPage = {
  events: [
    {
      service: 'gas',
      box: 'inbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b',
      eventId: '3f2c1a0e-1111-2222-3333-444455556666',
      type: 'case.status.updated',
      fullType: 'cloud.defra.prd.fg-cw-backend.case.status.updated',
      source: 'CW',
      target: null,
      segregationRef: 'GLD-9B2-BWS-grasslands',
      status: 'COMPLETED',
      attempts: 1,
      maxAttempts: 5,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      createdAt: '2026-06-16T10:00:00.000Z',
      lastFailureAt: null,
      completedAt: '2026-06-16T10:00:01.000Z',
      lastError: null,
      parked: null
    }
  ],
  pagination: {
    startCursor: 'START',
    endCursor: 'END',
    hasNextPage: true,
    hasPreviousPage: false
  },
  sourceErrors: []
}

const counts: EventCounts = {
  PUBLISHED: 12,
  PROCESSING: 3,
  FAILED: 1,
  RESUBMITTED: 0,
  COMPLETED: 236196,
  DEAD_LETTER: 7064,
  PARKED: 12
}

/**
 * The whole of the counts read: the status counts, and nothing derived from
 * them. `total` was their sum, sent alongside them; the page adds them up.
 */
const facets: EventFacets = { counts }

const responseError = (statusCode: number, statusMessage: string, body = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode} ${statusMessage}`), {
    data: { payload: body, res: {} }
  })

/** One failure, and every dead letter it caused, as the breakdown reports it. */
const groups = [
  {
    error: 'E11000 duplicate key error collection: gas.events',
    type: 'case.status.updated',
    count: 4182,
    firstAt: '2026-06-15T10:00:00.000Z',
    lastAt: '2026-06-16T10:16:05.000Z'
  }
]

describe('getEventsUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvents).mockResolvedValue(page)
    vi.mocked(findEventCounts).mockResolvedValue({
      ...facets,
      sourceErrors: []
    })
    vi.mocked(findEventBreakdown).mockResolvedValue({
      groups,
      sourceErrors: []
    })
  })

  test('returns the page the repository read', async () => {
    const { page: read } = await getEventsUseCase({})

    expect(read).toEqual(page)
  })

  test('reports a page it read as available', async () => {
    await expect(getEventsUseCase({})).resolves.toEqual({
      page,
      facets,
      breakdown: { groups, sourceErrors: [] },
      unavailable: false
    })
  })

  // The counts respect the filters the list respects, minus the two that make
  // no sense for them: `status`, because the counts *are* the status
  // breakdown, and the cursor, because a keyset position is a fact about a
  // page and these are facts about the whole set.
  test('counts the same filters the list is asking about, without the status', async () => {
    await getEventsUseCase({
      cursor: 'END',
      direction: 'forward',
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(findEventCounts).toHaveBeenCalledTimes(1)
    expect(findEventCounts).toHaveBeenCalledWith({
      service: 'gas',
      q: 'gld-9b2',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })
  })

  test('reads the rows and the counts together', async () => {
    await getEventsUseCase({})

    expect(findEvents).toHaveBeenCalledTimes(1)
    expect(findEventCounts).toHaveBeenCalledTimes(1)
  })

  // A summary that could not be read has not made the table below it an
  // error: the page keeps its rows and the strip falls back to counting them.
  test('reports no counts, and no outage, when only the counts failed', async () => {
    vi.mocked(findEventCounts).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    const {
      page: read,
      facets: readFacets,
      unavailable
    } = await getEventsUseCase({})

    expect(read).toEqual(page)
    expect(readFacets).toBeNull()
    expect(unavailable).toBe(false)
  })

  test('logs one line naming a counts failure', async () => {
    vi.mocked(findEventCounts).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read event counts from fg-gas-backend: Error: Response Error: 502 Bad Gateway'
    )
  })

  // The two reads are independent in both directions: rows that could not be
  // read do not take the counts down with them either.
  test('still reports the counts when the rows could not be read', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502, 'Bad Gateway'))

    const { facets: read, unavailable } = await getEventsUseCase({})

    expect(read).toEqual(facets)
    expect(unavailable).toBe(true)
  })

  test('asks for the page the caller asked for', async () => {
    const query = { cursor: 'END', direction: 'forward', status: 'FAILED' }

    await getEventsUseCase(query)

    expect(findEvents).toHaveBeenCalledTimes(1)
    expect(findEvents).toHaveBeenCalledWith(query)
  })

  test('reports the page unavailable when the query is one the endpoint refuses', async () => {
    vi.mocked(findEvents).mockRejectedValue(
      responseError(400, 'Bad Request', { message: 'is not allowed' })
    )

    await expect(getEventsUseCase({ status: 'BOGUS' })).resolves.toEqual(
      expect.objectContaining({ unavailable: true })
    )
  })

  test('reports the page unavailable when the cursor cannot be decoded', async () => {
    vi.mocked(findEvents).mockRejectedValue(
      responseError(400, 'Bad Request', { message: 'Cannot decode cursor' })
    )

    await expect(getEventsUseCase({ cursor: 'nope' })).resolves.toEqual(
      expect.objectContaining({ unavailable: true })
    )
  })

  test('reports the page unavailable when both GAS reads fail', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502, 'Bad Gateway'))

    const { unavailable } = await getEventsUseCase({})

    expect(unavailable).toBe(true)
  })

  test('returns an empty page when the backend fails', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502, 'Bad Gateway'))

    const { page: read } = await getEventsUseCase({})

    expect(read).toEqual({
      events: [],
      pagination: {
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false
      },
      sourceErrors: []
    })
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502, 'Bad Gateway'))

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read events from fg-gas-backend: Error: Response Error: 502 Bad Gateway'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(findEvents).mockRejectedValue(
      responseError(500, 'Internal Server Error', {
        message: 'mongo connection string'
      })
    )

    await getEventsUseCase({})

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(typeof line).toBe('string')
    expect(String(line)).not.toContain('mongo')
  })

  // The third read: which failures the dead letters actually are. It runs
  // beside the other two and, like the counts, is allowed to fail on its own.
  test('reads the rows, the counts and the breakdown together', async () => {
    await getEventsUseCase({})

    expect(findEvents).toHaveBeenCalledTimes(1)
    expect(findEventCounts).toHaveBeenCalledTimes(1)
    expect(findEventBreakdown).toHaveBeenCalledTimes(1)
  })

  // The breakdown is about dead letters and nothing else, so `status` is not
  // among the filters it takes — and neither is `error`, which is what it
  // produces.
  test('asks for the breakdown under the same filters, minus the status', async () => {
    await getEventsUseCase({
      cursor: 'END',
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      error: 'boom',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(findEventBreakdown).toHaveBeenCalledWith({
      service: 'gas',
      q: 'gld-9b2',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })
  })

  // The counts are the figure the `Redrive all N matching` button quotes, so a
  // page narrowed to one failure has to be counted as narrowly as it is listed.
  test('counts the failure filter too', async () => {
    await getEventsUseCase({ error: 'boom', service: 'gas' })

    expect(findEventCounts).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'boom', service: 'gas' })
    )
  })

  test('returns the breakdown the repository read', async () => {
    const { breakdown } = await getEventsUseCase({})

    expect(breakdown).toEqual({ groups, sourceErrors: [] })
  })

  // A page filtered to any other status could not draw the panel, so it does
  // not ask: a third read on every page load for a panel nobody can see.
  test.each([['COMPLETED'], ['FAILED'], ['PARKED']])(
    'asks for no breakdown on a page filtered to %s',
    async (status) => {
      const { breakdown } = await getEventsUseCase({ status })

      expect(findEventBreakdown).not.toHaveBeenCalled()
      expect(breakdown).toBeNull()
    }
  )

  // The panel is an aid to triage above a table that works without it, so a
  // breakdown that could not be read is a page with no panel and no alert.
  test('reports no breakdown, and no outage, when only the breakdown failed', async () => {
    vi.mocked(findEventBreakdown).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    const { page: read, breakdown, unavailable } = await getEventsUseCase({})

    expect(read).toEqual(page)
    expect(breakdown).toBeNull()
    expect(unavailable).toBe(false)
  })

  test('logs one line naming a breakdown failure', async () => {
    vi.mocked(findEventBreakdown).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read the event breakdown from fg-gas-backend: Error: Response Error: 502 Bad Gateway'
    )
  })
})

// The figure the bulk-redrive confirmation quotes before it writes. It is read
// there rather than passed on a url: a count on a query string is a count
// anybody can edit.
describe('getEventCountsUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEventCounts).mockResolvedValue({
      ...facets,
      sourceErrors: []
    })
  })

  test('returns the counts the repository read', async () => {
    await expect(getEventCountsUseCase({ service: 'gas' })).resolves.toEqual(
      facets
    )
  })

  // The partial-source report belongs to the list read, which says it once in
  // an alert of its own; carrying a second copy of it here would be a second
  // place the page could disagree with itself about what answered.
  test('drops the source errors the counts read reports of its own', async () => {
    vi.mocked(findEventCounts).mockResolvedValue({
      ...facets,
      sourceErrors: [
        { service: 'caseworking', box: 'inbox', message: 'timeout' }
      ]
    })

    await expect(getEventCountsUseCase({})).resolves.not.toHaveProperty(
      'sourceErrors'
    )
  })

  test('asks for exactly the filters it was given', async () => {
    await getEventCountsUseCase({ service: 'gas', error: 'boom' })

    expect(findEventCounts).toHaveBeenCalledWith({
      service: 'gas',
      error: 'boom'
    })
  })

  // The confirmation still offers the write when the count could not be read —
  // the backend counts it again for itself — so this answers null rather than
  // throwing.
  test('answers null when the counts could not be read', async () => {
    vi.mocked(findEventCounts).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    await expect(getEventCountsUseCase({})).resolves.toBeNull()
  })
})
