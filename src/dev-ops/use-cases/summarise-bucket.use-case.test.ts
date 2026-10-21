import { logger } from '../../common/logger.ts'
import type { SummaryResult } from '../repositories/buckets.repository.ts'
import { summariseBucket } from '../repositories/buckets.repository.ts'
import { summarisedBucket } from './test-fixtures.ts'
import { summariseBucketUseCase } from './summarise-bucket.use-case.ts'

vi.mock(import('../repositories/buckets.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const responseError = (statusCode: number) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: {} }
  })

const result: SummaryResult = {
  bucket: 'gas.outbox',
  summary: 'errors',
  entries: [],
  more: false,
  complete: true
}

describe('summariseBucketUseCase', () => {
  test('asks for the summary of the bucket as the list is read', async () => {
    vi.mocked(summariseBucket).mockResolvedValue(result)

    await expect(
      summariseBucketUseCase(summarisedBucket, 'errors', {
        from: '2026-10-08T09:20:00.000Z'
      })
    ).resolves.toEqual({
      page: result,
      unavailable: false,
      refused: false,
      refusal: null
    })
    expect(summariseBucket).toHaveBeenCalledWith('gas.outbox', 'errors', {
      from: '2026-10-08T09:20:00.000Z'
    })
  })

  test('answers no summary, and says so, when GAS cannot be read', async () => {
    const badGateway = 502

    vi.mocked(summariseBucket).mockRejectedValue(responseError(badGateway))

    await expect(
      summariseBucketUseCase(summarisedBucket, 'errors', {})
    ).resolves.toMatchObject({ page: null, unavailable: true })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
