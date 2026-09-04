import { logger } from '../../common/logger.ts'
import type {
  Event,
  EventDetail,
  EventsPage
} from '../repositories/events.repository.ts'
import { findEvent, findEvents } from '../repositories/events.repository.ts'
import { getEventUseCase } from './get-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key = { service: 'gas', box: 'outbox', id: '665f1c2e9a1b2c3d4e5f6a7b' }

const row = (overrides: Partial<Event> = {}): Event => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  source: null,
  target: 'gas__sns__update_case_status_fifo',
  segregationRef: 'GLD-9B2-BWS-grasslands',
  status: 'DEAD_LETTER',
  attempts: 5,
  maxAttempts: 5,
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  completedAt: null,
  lastError: null,
  parked: null,
  ...overrides
})

const detail: EventDetail = {
  ...row(),
  attemptHistory: [],
  payload: { data: { caseRef: 'GLD-9B2' } },
  targetRaw:
    'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo',
  messageId: 'a0e1b2c3-4444-5555-6666-777788889999',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastRedrive: null
}

const journeyPage = (events: Event[]): EventsPage => ({
  events,
  pagination: {
    startCursor: null,
    endCursor: null,
    hasNextPage: false,
    hasPreviousPage: false
  },
  sourceErrors: []
})

/**
 * A failure as `@hapi/wreck` raises one: a Boom carrying the upstream status
 * and, where the endpoint sent one, its response body.
 */
const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('getEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvent).mockResolvedValue(detail)
    vi.mocked(findEvents).mockResolvedValue(journeyPage([row()]))
  })

  test('reads the event the caller asked for', async () => {
    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
    expect(findEvent).toHaveBeenCalledWith(key)
  })

  test('returns the event it read', async () => {
    const { outcome, event } = await getEventUseCase(key)

    expect(outcome).toBe('found')
    expect(event).toEqual(detail)
  })

  // The question an operator asks next is "where else did this message go?",
  // and the list endpoint already answers it — by event id, and by nothing
  // else, so no filter can hide the earlier healthy hops.
  test('asks the list endpoint for every hop carrying this event id', async () => {
    await getEventUseCase(key)

    expect(findEvents).toHaveBeenCalledTimes(1)
    expect(findEvents).toHaveBeenCalledWith({
      q: '3f2c1a0e-1111-2222-3333-444455556666'
    })
  })

  test('returns every hop the list endpoint answered with', async () => {
    vi.mocked(findEvents).mockResolvedValue(
      journeyPage([row(), row({ id: 'other', box: 'inbox' })])
    )

    const { journey } = await getEventUseCase(key)

    expect(journey).toHaveLength(2)
  })

  // One hop the page cannot draw is not worth losing the event over.
  test('keeps the event when only the journey could not be read', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502))

    const { outcome, event, journey } = await getEventUseCase(key)

    expect(outcome).toBe('found')
    expect(event).toEqual(detail)
    expect(journey).toEqual([])
  })

  test('logs one line when the journey could not be read', async () => {
    vi.mocked(findEvents).mockRejectedValue(responseError(502))

    await getEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not read the journey for event')
    )
  })

  // A 404 is a page of its own: the link was stale, and that is not an error.
  test('reports an event the endpoint does not have as not found', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'not-found',
      event: null,
      journey: []
    })
  })

  test('asks for no journey for an event that does not exist', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await getEventUseCase(key)

    expect(findEvents).not.toHaveBeenCalled()
  })

  test('reports a backend that could not be reached as unavailable', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(502))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'unavailable',
      event: null,
      journey: []
    })
  })

  test('reports a rejected address as unavailable rather than missing', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(400))

    const { outcome } = await getEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

  // A timeout carries no status at all, and is still not a 404.
  test('reports a failure with no status as unavailable', async () => {
    vi.mocked(findEvent).mockRejectedValue(new Error('socket hang up'))

    const { outcome } = await getEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(502))

    await getEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      'Could not read event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b from fg-gas-backend: Error: Response Error: 502'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(findEvent).mockRejectedValue(
      responseError(500, { message: 'mongo connection string' })
    )

    await getEventUseCase(key)

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(String(line)).not.toContain('mongo')
  })
})
