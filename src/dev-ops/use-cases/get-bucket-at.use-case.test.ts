import { logger } from '../../common/logger.ts'
import { findShell } from '../repositories/shell.repository.ts'
import { getBucketAtUseCase } from './get-bucket-at.use-case.ts'
import { catalogue, outboxBucket } from './test-fixtures.ts'

vi.mock(import('../repositories/shell.repository.ts'))
vi.mock(import('../../common/logger.ts'))

describe('getBucketAtUseCase', () => {
  test('finds the bucket the catalogue lists at a path', async () => {
    vi.mocked(findShell).mockResolvedValue({ catalogue })

    await expect(getBucketAtUseCase('events/gas/outbox')).resolves.toEqual({
      available: true,
      bucket: outboxBucket
    })
  })

  test('says a bucket the catalogue does not list is missing', async () => {
    vi.mocked(findShell).mockResolvedValue({ catalogue })

    await expect(getBucketAtUseCase('events/gas/nothing')).resolves.toEqual({
      available: true,
      bucket: null
    })
  })

  test('says nothing is known when no catalogue could be read', async () => {
    vi.mocked(findShell).mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(getBucketAtUseCase('events/gas/outbox')).resolves.toEqual({
      available: false,
      bucket: null
    })
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('Could not read the bucket catalogue')
    )
  })
})
