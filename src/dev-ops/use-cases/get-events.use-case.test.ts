import { logger } from '../../common/logger.ts'
import type { EventsPage } from '../repositories/events.repository.ts'
import { findEvents } from '../repositories/events.repository.ts'
import { getEventsUseCase } from './get-events.use-case.ts'

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
      completedAt: '2026-06-16T10:00:01.000Z'
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

const responseError = (statusCode: number, statusMessage: string, body = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode} ${statusMessage}`), {
    data: { payload: body, res: {} }
  })

describe('getEventsUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvents).mockResolvedValue(page)
  })

  test('returns the page the repository read', async () => {
    const { page: read } = await getEventsUseCase({})

    expect(read).toEqual(page)
  })

  test('reports a page it read as available', async () => {
    await expect(getEventsUseCase({})).resolves.toEqual({
      page,
      unavailable: false
    })
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
})
