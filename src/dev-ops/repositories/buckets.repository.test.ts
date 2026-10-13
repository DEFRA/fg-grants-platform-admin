import { getFromGas, postToGas } from '../../common/gas.ts'
import {
  findBuckets,
  queryBucket,
  summariseBucket
} from './buckets.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('findBuckets', () => {
  test('reads the catalogue from fg-gas-backend', async () => {
    const catalogue = { buckets: [], sourceErrors: [{ hop: 'CW-BE' }] }

    vi.mocked(getFromGas).mockResolvedValue(catalogue)

    await expect(findBuckets()).resolves.toEqual(catalogue)
    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/buckets')
  })
})

describe('queryBucket', () => {
  test('posts the query, so a ref never travels in a URL', async () => {
    await queryBucket(
      'gas.outbox',
      { where: { status: 'DEAD_LETTER' }, ref: 'ref:abc-123-xyz', limit: 20 },
      false
    )

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/buckets/gas.outbox/query',
      {
        payload: {
          where: { status: 'DEAD_LETTER' },
          ref: 'ref:abc-123-xyz',
          limit: 20
        }
      }
    )
  })

  test('marks a repeated first page as one', async () => {
    await queryBucket('gas.applications', { where: {} }, true)

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/buckets/gas.applications/query',
      { payload: { where: {} }, headers: { 'x-search-repeat': '1' } }
    )
  })

  test('escapes the bucket id into one path segment', async () => {
    await queryBucket('a/b?c', {}, false)

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/buckets/a%2Fb%3Fc/query',
      { payload: {} }
    )
  })
})

describe('summariseBucket', () => {
  test('posts the range to the summary of the bucket', async () => {
    await summariseBucket('gas.outbox', 'errors', {
      from: '2026-10-08T09:20:00.000Z'
    })

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/buckets/gas.outbox/summaries/errors',
      { payload: { from: '2026-10-08T09:20:00.000Z' } }
    )
  })

  test('escapes both ids into one path segment each', async () => {
    await summariseBucket('a/b', 'c?d', {})

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/buckets/a%2Fb/summaries/c%3Fd',
      { payload: {} }
    )
  })
})
