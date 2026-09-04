import { logger } from '../../common/logger.ts'
import { parkEvent, unparkEvent } from '../repositories/events.repository.ts'
import { parkEventUseCase, unparkEventUseCase } from './park-event.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const key = { service: 'gas', box: 'outbox', id: '665f1c2e9a1b2c3d4e5f6a7b' }

/**
 * A failure as `@hapi/wreck` raises one: a Boom carrying the upstream status
 * and, where the endpoint sent one, its response body.
 */
const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

const parked = { event: { status: 'PARKED' } } as never

describe('parkEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(parkEvent).mockResolvedValue(parked)
  })

  test('parks the event, with the reason and the person who asked', async () => {
    await parkEventUseCase(key, 'duplicate key on a dead case', 'Ada Lovelace')

    expect(parkEvent).toHaveBeenCalledTimes(1)
    expect(parkEvent).toHaveBeenCalledWith(
      key,
      'duplicate key on a dead case',
      'Ada Lovelace'
    )
  })

  test('reports a park the backend accepted', async () => {
    await expect(parkEventUseCase(key, 'why')).resolves.toEqual({
      outcome: 'parked',
      status: null
    })
  })

  // The interesting one: the event moved on between the page being drawn and
  // the button being pressed. Nothing went wrong, and the page has to say which
  // state it is actually in.
  test('reports a conflict, naming the status that refused it', async () => {
    vi.mocked(parkEvent).mockRejectedValue(
      responseError(409, { status: 'COMPLETED' })
    )

    await expect(parkEventUseCase(key, 'why')).resolves.toEqual({
      outcome: 'conflict',
      status: 'COMPLETED'
    })
  })

  test('reports a conflict with no status when the body carried none', async () => {
    vi.mocked(parkEvent).mockRejectedValue(responseError(409))

    await expect(parkEventUseCase(key, 'why')).resolves.toEqual({
      outcome: 'conflict',
      status: null
    })
  })

  test.each([
    [404, 'not-found'],
    [502, 'unavailable'],
    [401, 'unavailable']
  ])('reports a %s as %s', async (statusCode, outcome) => {
    vi.mocked(parkEvent).mockRejectedValue(responseError(statusCode))

    await expect(parkEventUseCase(key, 'why')).resolves.toEqual({
      outcome,
      status: null
    })
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(parkEvent).mockRejectedValue(responseError(502))

    await parkEventUseCase(key, 'why')

    expect(logger.error).toHaveBeenCalledWith(
      'Could not park event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b in fg-gas-backend: Error: Response Error: 502'
    )
  })

  // The reason is free text an operator typed about a failing message, and it
  // has no business in a log line — the address is what identifies the write.
  test('never logs the reason', async () => {
    vi.mocked(parkEvent).mockRejectedValue(responseError(502))

    await parkEventUseCase(key, 'ticket FGP-1392, waiting on the topic fix')

    expect(String(vi.mocked(logger.error).mock.calls[0][0])).not.toContain(
      'FGP-1392'
    )
  })
})

describe('unparkEventUseCase', () => {
  beforeEach(() => {
    vi.mocked(unparkEvent).mockResolvedValue(parked)
  })

  test('unparks the event, naming the person who asked', async () => {
    await unparkEventUseCase(key, 'Ada Lovelace')

    expect(unparkEvent).toHaveBeenCalledTimes(1)
    expect(unparkEvent).toHaveBeenCalledWith(key, 'Ada Lovelace')
  })

  test('reports an unpark the backend accepted', async () => {
    await expect(unparkEventUseCase(key)).resolves.toEqual({
      outcome: 'parked',
      status: null
    })
  })

  test('reports a conflict, naming the status that refused it', async () => {
    vi.mocked(unparkEvent).mockRejectedValue(
      responseError(409, { status: 'RESUBMITTED' })
    )

    await expect(unparkEventUseCase(key)).resolves.toEqual({
      outcome: 'conflict',
      status: 'RESUBMITTED'
    })
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(unparkEvent).mockRejectedValue(responseError(502))

    await unparkEventUseCase(key)

    expect(logger.error).toHaveBeenCalledWith(
      'Could not unpark event gas/outbox/665f1c2e9a1b2c3d4e5f6a7b in fg-gas-backend: Error: Response Error: 502'
    )
  })
})
