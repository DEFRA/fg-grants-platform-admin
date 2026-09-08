import { logger } from '../../common/logger.ts'
import type {
  EventCounts,
  EventFacets,
  EventsPage,
  ServiceFilter,
  StatusFilter
} from '../repositories/events.repository.ts'
import { findEventsPage } from '../repositories/events.repository.ts'
import { getEventsUseCase } from './get-events.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

/**
 * An inbox row as the endpoint sends it: a message this service received, so
 * it names its producer and has no topic of its own to copy.
 */
const page: EventsPage = {
  events: [
    {
      service: 'gas',
      box: 'inbox',
      id: '665f1c2e9a1b2c3d4e5f6a7b',
      eventId: '3f2c1a0e-1111-2222-3333-444455556666',
      type: 'case.status.updated',
      hop: 'GAS Inbox',
      queue: 'from Caseworking',
      queueValue: null,
      status: 'COMPLETED',
      statusLabel: 'Completed',
      statusRole: 'success',
      statusRetrying: false,
      createdAt: '2026-06-16T10:00:00.000Z',
      lastError: null,
      latency: '1.0s',
      latencyTitle: 'Received to completed'
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
  DEAD_LETTER: 7064
}

/**
 * The whole of the counts read: the status counts, and nothing derived from
 * them.
 */
const facets: EventFacets = { counts }

/** The words the toolbar's chips are drawn in, as the endpoint states them. */
const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Published',
    explainer: 'Queued, not yet claimed'
  },
  { value: 'PROCESSING', label: 'Processing', explainer: 'Claimed, in flight' },
  { value: 'FAILED', label: 'Failed', explainer: 'Awaiting automatic retry' },
  {
    value: 'RESUBMITTED',
    label: 'Resubmitted',
    explainer: 'Queued for another retry cycle'
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    explainer: 'Processed successfully'
  },
  {
    value: 'DEAD_LETTER',
    label: 'Dead letter',
    explainer: 'Failed all retry attempts; needs a redrive'
  }
]

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * A failure as `@hapi/wreck` raises one: a Boom carrying the upstream status
 * on `output`, and, where the endpoint sent one, its response body. The status
 * is what tells a refused link from an unreachable backend.
 */
const responseError = (statusCode: number, statusMessage: string, body = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode} ${statusMessage}`), {
    output: { statusCode },
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
  /** The composed page the endpoint answers with, whole and healthy. */
  const composed = {
    ...page,
    statuses,
    services,
    counts,
    breakdown: { groups, sourceErrors: [] },
    sectionErrors: []
  }

  beforeEach(() => {
    vi.mocked(findEventsPage).mockResolvedValue(composed)
  })

  test('returns the page the repository read', async () => {
    const { page: read } = await getEventsUseCase({})

    expect(read).toEqual(page)
  })

  test('reports a page it read as available', async () => {
    await expect(getEventsUseCase({})).resolves.toEqual({
      page,
      statuses,
      services,
      facets,
      breakdown: { groups, sourceErrors: [] },
      unavailable: false
    })
  })

  // The chips' words arrive with the page: a table derived in two places
  // eventually reads two ways.
  test('hands the chip vocabulary through untouched', async () => {
    const read = await getEventsUseCase({})

    expect(read.statuses).toEqual(statuses)
    expect(read.services).toEqual(services)
  })

  // A page that could not be read draws no chips at all, so the vocabulary it
  // would have labelled them with is empty rather than invented here.
  test('offers no vocabulary for a page it could not read', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    const read = await getEventsUseCase({})

    expect(read.statuses).toEqual([])
    expect(read.services).toEqual([])
  })

  // One call, not three: fg-gas-backend composes the page itself.
  test('reads the whole page in a single call', async () => {
    await getEventsUseCase({})

    expect(findEventsPage).toHaveBeenCalledTimes(1)
  })

  // Every filter travels, untouched and unsplit: the endpoint decides which
  // of them each section respects.
  test('asks for the page the caller asked for, whole', async () => {
    const query = {
      cursor: 'END',
      direction: 'forward',
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      error: 'boom',
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    }

    await getEventsUseCase(query)

    expect(findEventsPage).toHaveBeenCalledTimes(1)
    expect(findEventsPage).toHaveBeenCalledWith(query)
  })

  // A summary that could not be read has not made the table below it an
  // error: the page keeps its rows and the segments go back to being words.
  test('reports no counts, and no outage, when the counts section is null', async () => {
    vi.mocked(findEventsPage).mockResolvedValue({
      ...composed,
      counts: null,
      sectionErrors: [{ section: 'counts', message: 'Bad Gateway' }]
    })

    const {
      page: read,
      facets: readFacets,
      unavailable
    } = await getEventsUseCase({})

    expect(read).toEqual(page)
    expect(readFacets).toBeNull()
    expect(unavailable).toBe(false)
  })

  // A null section is never silent: the endpoint says which one and why.
  test('logs one line naming a section that could not be read', async () => {
    vi.mocked(findEventsPage).mockResolvedValue({
      ...composed,
      counts: null,
      sectionErrors: [{ section: 'counts', message: 'Bad Gateway' }]
    })

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'fg-gas-backend could not read the counts for the events page: Bad Gateway'
    )
  })

  test('logs a line for every section that could not be read', async () => {
    vi.mocked(findEventsPage).mockResolvedValue({
      ...composed,
      counts: null,
      breakdown: null,
      sectionErrors: [
        { section: 'counts', message: 'Bad Gateway' },
        { section: 'breakdown', message: 'Timeout' }
      ]
    })

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  // The panel is an aid to triage above a table that works without it, so a
  // breakdown that could not be read is a page with no panel and no alert.
  test('reports no breakdown, and no outage, when the breakdown section is null', async () => {
    vi.mocked(findEventsPage).mockResolvedValue({
      ...composed,
      breakdown: null,
      sectionErrors: [{ section: 'breakdown', message: 'Bad Gateway' }]
    })

    const { page: read, breakdown, unavailable } = await getEventsUseCase({})

    expect(read).toEqual(page)
    expect(breakdown).toBeNull()
    expect(unavailable).toBe(false)
  })

  test('returns the breakdown the endpoint composed', async () => {
    const { breakdown } = await getEventsUseCase({})

    expect(breakdown).toEqual({ groups, sourceErrors: [] })
  })

  // The panel is about dead letters and nothing else. That rule is about what
  // this page draws rather than what the endpoint can answer, so it stays
  // here: the breakdown arrives on every page and is ignored on the ones that
  // could never draw it.
  test.each([['COMPLETED'], ['FAILED'], ['PUBLISHED']])(
    'draws no breakdown on a page filtered to %s, whatever the endpoint sent',
    async (status) => {
      const { breakdown } = await getEventsUseCase({ status })

      expect(breakdown).toBeNull()
    }
  )

  // The rows are the page. Unlike the two aggregations they are not nullable,
  // so a read that fails is the whole page failing — the one state this app
  // paints as an outage rather than as a quieter page.
  test('reports the page unavailable when the read fails', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    await expect(getEventsUseCase({})).resolves.toEqual({
      page: {
        events: [],
        pagination: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false
        },
        sourceErrors: []
      },
      statuses: [],
      services: [],
      facets: null,
      breakdown: null,
      unavailable: true,
      refused: false
    })
  })

  // A 4xx is this link, not this platform: the endpoint understood the
  // request and would not serve it. Painting that as an outage tells an
  // operator the estate is down on the page they opened to find out.
  test('reports a refused query as refused, not as an outage', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(400, 'Bad Request', { message: 'is not allowed' })
    )

    await expect(getEventsUseCase({ status: 'BOGUS' })).resolves.toEqual(
      expect.objectContaining({ unavailable: false, refused: true })
    )
  })

  // A hand-edited cursor is the commonest way to reach a 400 here, and it is
  // the operator's own link rather than anything being down.
  test('reports a cursor the endpoint would not decode as refused', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(400, 'Bad Request', { message: 'Cannot decode cursor' })
    )

    await expect(getEventsUseCase({ cursor: 'nope' })).resolves.toEqual(
      expect.objectContaining({ unavailable: false, refused: true })
    )
  })

  // 400 is the ONLY status that means "your parameters". The rest of the 4xx
  // range is the estate failing in ways no edit to the link can fix, and
  // saying "GAS refused this link's parameters" would send an operator hunting
  // for a typo that is not there:
  //   401/403 - this app's own credential, or a client it is not allowed to be
  //   404     - the endpoint moved, or was never deployed
  //   429     - the endpoint asking us to slow down
  test.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [429, 'Too Many Requests']
  ])('reports a %i as unavailable, not as a refusal', async (status, text) => {
    vi.mocked(findEventsPage).mockRejectedValue(responseError(status, text))

    await expect(getEventsUseCase({})).resolves.toEqual(
      expect.objectContaining({ unavailable: true, refused: false })
    )
  })

  // The same rule from the other side: the page must not tell an operator to
  // check their link when nothing about the link is wrong.
  test.each([401, 403, 404, 429])(
    'logs a %i as a failure to read, not as refused parameters',
    async (status) => {
      vi.mocked(findEventsPage).mockRejectedValue(responseError(status, 'x'))

      await getEventsUseCase({})

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not read the events page')
      )
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  test('logs one line naming the failure', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(502, 'Bad Gateway')
    )

    await getEventsUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read the events page from fg-gas-backend: Error: Response Error: 502 Bad Gateway'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(findEventsPage).mockRejectedValue(
      responseError(500, 'Internal Server Error', {
        message: 'mongo connection string'
      })
    )

    await getEventsUseCase({})

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(typeof line).toBe('string')
    expect(String(line)).not.toContain('mongo')
  })
})
