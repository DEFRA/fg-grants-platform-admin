import { logger } from '../../common/logger.ts'
import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { getEventUseCase } from './get-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const detail: EventDetail = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  targetTopic: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { data: { caseRef: 'GLD-9B2' } },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null
}

const composed = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  ...detail,
  ...overrides
})

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('getEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(findEvent).mockResolvedValue(composed())
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

  test('reads the event in a single call', async () => {
    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test('hands back the event the endpoint sent', async () => {
    const { event } = await getEventUseCase(key)

    expect(event).toEqual(detail)
    expect(event).not.toHaveProperty('journey')
    expect(event).not.toHaveProperty('services')
  })

  test('reports an event the endpoint does not have as not found', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'not-found',
      event: null
    })
  })

  test('reports a read the backend timed out on as timed out', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(504))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'timed-out',
      event: null
    })
  })

  test('makes no second call for an event that does not exist', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(404))

    await getEventUseCase(key)

    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test('reports a backend that could not be reached as unavailable', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(502))

    await expect(getEventUseCase(key)).resolves.toEqual({
      outcome: 'unavailable',
      event: null
    })
  })

  test('reports a rejected address as unavailable rather than missing', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(400))

    const { outcome } = await getEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

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
