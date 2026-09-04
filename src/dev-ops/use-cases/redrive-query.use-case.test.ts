import { logger } from '../../common/logger.ts'
import { redriveByQuery } from '../repositories/events.repository.ts'
import { redriveQueryUseCase } from './redrive-query.use-case.ts'

vi.mock(import('../repositories/events.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const result = {
  matched: 7064,
  processed: 500,
  redriven: 498,
  conflicts: 1,
  failures: 1,
  perSource: [
    {
      service: 'gas',
      box: 'outbox',
      matched: 7064,
      processed: 500,
      redriven: 498,
      conflicts: 1,
      failures: 1
    }
  ],
  sourceErrors: []
}

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

describe('redriveQueryUseCase', () => {
  beforeEach(() => {
    vi.mocked(redriveByQuery).mockResolvedValue(result)
  })

  test('writes with the filters it was given, naming who asked', async () => {
    await redriveQueryUseCase(
      { service: 'gas', error: 'boom', limit: '500' },
      'Ada Lovelace'
    )

    expect(redriveByQuery).toHaveBeenCalledTimes(1)
    expect(redriveByQuery).toHaveBeenCalledWith(
      { service: 'gas', error: 'boom', limit: '500' },
      'Ada Lovelace'
    )
  })

  test('returns the five figures the backend answered with', async () => {
    await expect(redriveQueryUseCase({})).resolves.toEqual({
      result,
      unavailable: false
    })
  })

  // One read, not a loop: a client that retried until `processed` reached
  // `matched` would be hammering a queue already having a bad day. Running it
  // again is the operator's decision, and the results page offers it.
  test('asks once, whatever the backend reports it reached', async () => {
    await redriveQueryUseCase({})

    expect(redriveByQuery).toHaveBeenCalledTimes(1)
  })

  test('reports the write as unavailable when it could not be made', async () => {
    vi.mocked(redriveByQuery).mockRejectedValue(responseError(502))

    await expect(redriveQueryUseCase({})).resolves.toEqual({
      result: null,
      unavailable: true
    })
  })

  test('logs one line naming the failure', async () => {
    vi.mocked(redriveByQuery).mockRejectedValue(responseError(502))

    await redriveQueryUseCase({})

    expect(logger.error).toHaveBeenCalledWith(
      'Could not redrive events by query in fg-gas-backend: Error: Response Error: 502'
    )
  })

  test('never logs the backend response body', async () => {
    vi.mocked(redriveByQuery).mockRejectedValue(
      responseError(500, { message: 'mongo connection string' })
    )

    await redriveQueryUseCase({})

    expect(String(vi.mocked(logger.error).mock.calls[0][0])).not.toContain(
      'mongo'
    )
  })
})
