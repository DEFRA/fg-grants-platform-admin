import { logger } from '../../common/logger.ts'
import type { BucketResult } from '../repositories/buckets.repository.ts'
import { queryBucket } from '../repositories/buckets.repository.ts'
import { outboxBucket, toggledBucket } from './test-fixtures.ts'
import { queryBucketUseCase } from './query-bucket.use-case.ts'

vi.mock(import('../repositories/buckets.repository.ts'))
vi.mock(import('../../common/logger.ts'))

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body }
  })

const result: BucketResult = {
  bucket: 'gas.outbox',
  plan: {
    kind: 'exact',
    index: ['kind', 'publicationDate', '_id'],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: []
}

describe('queryBucketUseCase', () => {
  test('asks a first page for twenty rows and every grouping the bucket declares', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    await expect(
      queryBucketUseCase(
        outboxBucket,
        {
          where: { status: 'DEAD_LETTER' },
          ref: 'ref:abc-123-xyz',
          from: '2026-10-08T12:00:00.000Z'
        },
        true
      )
    ).resolves.toEqual({
      page: result,
      unavailable: false,
      refused: false,
      refusal: null,
      timedOut: false
    })
    expect(queryBucket).toHaveBeenCalledWith(
      'gas.outbox',
      {
        where: { status: 'DEAD_LETTER' },
        ref: 'ref:abc-123-xyz',
        from: '2026-10-08T12:00:00.000Z',
        limit: 20,
        groupBy: ['status']
      },
      true
    )
  })

  test('asks a later page for its rows alone', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    await queryBucketUseCase(
      outboxBucket,
      { where: {}, ref: 'ref:abc-123-xyz', cursor: 'eyJ0Ijoi' },
      false
    )

    expect(queryBucket).toHaveBeenCalledWith(
      'gas.outbox',
      { where: {}, ref: 'ref:abc-123-xyz', cursor: 'eyJ0Ijoi', limit: 20 },
      false
    )
  })

  test('sends the facts whose hidden values are asked for, on a first page and a later one', async () => {
    vi.mocked(queryBucket).mockResolvedValue(result)

    const search = { where: { status: 'DEAD_LETTER' }, show: ['eventType'] }

    await queryBucketUseCase(toggledBucket, search, false)
    await queryBucketUseCase(
      toggledBucket,
      { ...search, cursor: 'eyJ0Ijoi' },
      false
    )

    expect(queryBucket).toHaveBeenNthCalledWith(
      1,
      'gas.outbox',
      expect.objectContaining(search),
      false
    )
    expect(queryBucket).toHaveBeenNthCalledWith(
      2,
      'gas.outbox',
      { ...search, cursor: 'eyJ0Ijoi', limit: 20 },
      false
    )
  })

  test('carries the reason GAS gave for refusing a request', async () => {
    vi.mocked(queryBucket).mockRejectedValue(
      responseError(400, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'A filter names a fact this bucket does not declare',
        reason: 'UNKNOWN_FACT'
      })
    )

    await expect(
      queryBucketUseCase(outboxBucket, { where: { colour: 'x' } }, false)
    ).resolves.toEqual({
      page: null,
      unavailable: false,
      refused: true,
      refusal: 'A filter names a fact this bucket does not declare',
      timedOut: false
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('refused the bucket gas.outbox list parameters')
    )
  })

  test('says a refusal with no reason was one all the same', async () => {
    vi.mocked(queryBucket).mockRejectedValue(responseError(400))

    await expect(
      queryBucketUseCase(outboxBucket, { where: {} }, false)
    ).resolves.toMatchObject({ refused: true, refusal: null })
  })

  test.each([404, 502, 504])(
    'says the list is unavailable on a %i, carrying no reason',
    async (statusCode) => {
      vi.mocked(queryBucket).mockRejectedValue(
        responseError(statusCode, { message: 'No such bucket' })
      )

      await expect(
        queryBucketUseCase(outboxBucket, { where: {} }, false)
      ).resolves.toEqual({
        page: null,
        unavailable: true,
        refused: false,
        refusal: null,
        timedOut: false
      })
      expect(logger.error).toHaveBeenCalled()
    }
  )

  test('says a read GAS or CW ran out of time for timed out, so a narrower one can be asked for', async () => {
    vi.mocked(queryBucket).mockRejectedValue(
      responseError(504, {
        message: 'The read did not finish in time',
        reason: 'TIMED_OUT'
      })
    )

    await expect(
      queryBucketUseCase(outboxBucket, { where: {} }, false)
    ).resolves.toEqual({
      page: null,
      unavailable: true,
      refused: false,
      refusal: null,
      timedOut: true
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'ran out of time reading the bucket gas.outbox list'
      )
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test.each([
    [400, { message: 'Zebedee Orchard', reason: 'FIELD_WITH_FILTER' }],
    [504, { message: 'Zebedee Orchard', reason: 'TIMED_OUT' }],
    [502, { message: 'Zebedee Orchard' }]
  ])(
    'writes no part of a field search to the log on a %i',
    async (statusCode, body) => {
      vi.mocked(queryBucket).mockRejectedValue(responseError(statusCode, body))

      await queryBucketUseCase(
        outboxBucket,
        { where: {}, field: 'businessName:Zebedee Orchard' },
        false
      )

      const logged = [
        ...vi.mocked(logger.warn).mock.calls,
        ...vi.mocked(logger.error).mock.calls
      ]

      expect(logged).toHaveLength(1)
      expect(JSON.stringify(logged)).not.toContain('Zebedee')
    }
  )
})
