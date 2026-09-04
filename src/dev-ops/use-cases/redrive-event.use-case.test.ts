import { logger } from '../../common/logger.ts'
import { redriveEvent } from '../repositories/events.repository.ts'
import { redriveEventUseCase } from './redrive-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key = { service: 'gas', box: 'outbox', id: '665f1c2e9a1b2c3d4e5f6a7b' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('redriveEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(redriveEvent).mockResolvedValue({
      event: {
        service: 'gas',
        box: 'outbox',
        id: '665f1c2e9a1b2c3d4e5f6a7b',
        eventId: '3f2c1a0e-1111-2222-3333-444455556666',
        type: 'case.status.updated',
        fullType: null,
        source: null,
        target: 'gas__sns__update_case_status_fifo',
        segregationRef: null,
        status: 'RESUBMITTED',
        attempts: 0,
        maxAttempts: 5,
        traceId: null,
        createdAt: '2026-06-16T10:00:00.000Z',
        lastFailureAt: null,
        completedAt: null,
        lastError: null
      }
    })
  })

  test('asks the backend to redrive the event the caller named', async () => {
    await redriveEventUseCase(key)

    expect(redriveEvent).toHaveBeenCalledTimes(1)
    expect(redriveEvent).toHaveBeenCalledWith(key, undefined)
  })

  test('reports a redrive the backend accepted', async () => {
    await expect(redriveEventUseCase(key)).resolves.toEqual({
      outcome: 'redriven',
      status: null
    })
  })

  // Nothing went wrong: the event moved on between the page being drawn and
  // the button being pressed, and the status it is in now is the useful half.
  test('reports a refused redrive as a conflict, naming the status', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(
      responseError(409, { status: 'RESUBMITTED' })
    )

    await expect(redriveEventUseCase(key)).resolves.toEqual({
      outcome: 'conflict',
      status: 'RESUBMITTED'
    })
  })

  test('reports a conflict with no status in its body', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(409))

    await expect(redriveEventUseCase(key)).resolves.toEqual({
      outcome: 'conflict',
      status: null
    })
  })

  test('ignores a status the body did not send as a string', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(409, { status: 7 }))

    const { status } = await redriveEventUseCase(key)

    expect(status).toBeNull()
  })

  test('reports an event the backend no longer has as not found', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(404))

    await expect(redriveEventUseCase(key)).resolves.toEqual({
      outcome: 'not-found',
      status: null
    })
  })

  test('reports a backend that could not be reached as unavailable', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(502))

    await expect(redriveEventUseCase(key)).resolves.toEqual({
      outcome: 'unavailable',
      status: null
    })
  })

  test('reports a failure carrying no status as unavailable', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(new Error('socket hang up'))

    const { outcome } = await redriveEventUseCase(key)

    expect(outcome).toBe('unavailable')
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(502))

    await redriveEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      'Could not redrive event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b in fg-gas-backend: Error: Response Error: 502'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(
      responseError(500, { message: 'mongo connection string' })
    )

    await redriveEventUseCase(key)

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(String(line)).not.toContain('mongo')
  })
})
