import { logger } from '../../common/logger.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { purgeEvent } from '../repositories/events.repository.ts'
import { purgeEventUseCase } from './purge-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key: EventKey = {
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b'
}

const reason = { reasonCode: 'BROKEN_PAYLOAD', note: 'sheetId is a number' }

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('purgeEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(purgeEvent).mockResolvedValue(undefined)
  })

  test('asks the backend to purge the event the caller named, with the reason', async () => {
    await purgeEventUseCase(key, reason, 'Ada Lovelace')

    expect(purgeEvent).toHaveBeenCalledTimes(1)
    expect(purgeEvent).toHaveBeenCalledWith(key, reason, 'Ada Lovelace')
  })

  test('sends no actor where the session named nobody', async () => {
    await purgeEventUseCase(key, reason)

    expect(purgeEvent).toHaveBeenCalledWith(key, reason, undefined)
  })

  test('reports a purge the backend accepted', async () => {
    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'purged',
      status: null
    })
  })

  test('reports a refused purge as a conflict, in the words the backend sent', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(
      responseError(409, { status: 'RESUBMITTED', statusLabel: 'Resubmitted' })
    )

    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'conflict',
      status: 'Resubmitted'
    })
  })

  test('falls back to the raw status when the body labels none', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(
      responseError(409, { status: 'QUARANTINED' })
    )

    const { status } = await purgeEventUseCase(key, reason)

    expect(status).toBe('QUARANTINED')
  })

  test('reports a conflict with no status in its body', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(409))

    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'conflict',
      status: null
    })
  })

  test('reports an event the backend no longer has as not found', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(404))

    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'not-found',
      status: null
    })
  })

  test('reports a purge the owning service did not answer in time as timed out', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(504))

    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'timed-out',
      status: null
    })
  })

  test('reports a backend that could not be reached as unavailable', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(502))

    await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
      outcome: 'unavailable',
      status: null
    })
  })

  test.each([400, 422])(
    'reports a %i as rejected, not as unavailable',
    async (statusCode) => {
      vi.mocked(purgeEvent).mockRejectedValue(responseError(statusCode))

      await expect(purgeEventUseCase(key, reason)).resolves.toEqual({
        outcome: 'rejected',
        status: null
      })
    }
  )

  test('reports a failure carrying no status as unavailable', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(new Error('socket hang up'))

    const { outcome } = await purgeEventUseCase(key, reason)

    expect(outcome).toBe('unavailable')
  })

  test('logs a conflict as a warning, not an error', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(409))

    await purgeEventUseCase(key, reason)

    expect(logger.warn).toHaveBeenCalledWith(
      'Did not purge event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b: conflict'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('logs a rejection as a warning naming its status and nothing it sent', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(
      responseError(422, { message: 'note is required' })
    )

    await purgeEventUseCase(key, { reasonCode: 'OTHER', note: 'Mrs Hudson' })

    expect(logger.warn).toHaveBeenCalledWith(
      'Did not purge event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b: rejected with 422'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(responseError(502))

    await purgeEventUseCase(key, reason)

    expect(logger.error).toHaveBeenCalledWith(
      'Could not purge event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b in fg-gas-backend: Error: Response Error: 502'
    )
  })

  // The note is the operator's prose and may name a case or a person.
  test('never logs the reason, the note or the backend response body', async () => {
    vi.mocked(purgeEvent).mockRejectedValue(
      responseError(500, { message: 'mongo connection string' })
    )

    await purgeEventUseCase(key, { reasonCode: 'OTHER', note: 'Mrs Hudson' })

    const [line] = vi.mocked(logger.error).mock.calls[0]

    expect(String(line)).not.toContain('mongo')
    expect(String(line)).not.toContain('Hudson')
    expect(String(line)).not.toContain('OTHER')
  })
})
