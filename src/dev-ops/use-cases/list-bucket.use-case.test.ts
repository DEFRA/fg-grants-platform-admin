import Boom from '@hapi/boom'

import type { BucketResult } from '../repositories/buckets.repository.ts'
import type { ListPages } from '../repositories/lists.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import { listBucketUseCase } from './list-bucket.use-case.ts'
import type { ListAsk } from './list-bucket.use-case.ts'
import { toShell } from '../test-utils.ts'

vi.mock(import('../repositories/lists.repository.ts'))

const shell = toShell('answered')

const page = {
  bucket: 'gas.outbox',
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  total: { count: 3, capped: false }
} as unknown as BucketResult

const pages = (overrides: Partial<ListPages> = {}): ListPages => ({
  ...page,
  pageRows: [0],
  stopped: null,
  refusedSearch: null,
  ...overrides
})

const ask: ListAsk = {
  path: 'events/gas/outbox',
  address: { status: ['DEAD_LETTER'] },
  window: {},
  place: {},
  search: { q: 'ref:abc', repeat: false }
}

const asked = () => vi.mocked(queryList).mock.calls.at(-1)?.[0]

/** As @hapi/wreck rejects for GAS's answer, carrying its body. */
const gasAnswer = (statusCode: number, body: object) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: { statusCode, ...body, shell } }
  })

describe('listBucketUseCase', () => {
  test('asks GAS once, as it was asked, and hands back every page read', async () => {
    vi.mocked(queryList).mockResolvedValue({
      shell,
      bucket: 'gas.outbox',
      list: pages({ pageRows: [0, 0] })
    })

    await expect(listBucketUseCase(ask)).resolves.toEqual({
      kind: 'listed',
      bucket: 'gas.outbox',
      listing: {
        read: { kind: 'read', page },
        refusedSearch: null,
        pageRows: [0, 0],
        stopped: null
      }
    })
    expect(queryList).toHaveBeenCalledExactlyOnceWith({
      path: 'events/gas/outbox',
      params: { status: ['DEAD_LETTER'] },
      search: 'ref:abc',
      count: true,
      repeat: false
    })
  })

  test('a refused search: the rows GAS read without it, with the refusal', async () => {
    vi.mocked(queryList).mockResolvedValue({
      shell,
      bucket: 'gas.outbox',
      list: pages({ refusedSearch: { refusal: 'ref is not valid' } })
    })

    await expect(listBucketUseCase(ask)).resolves.toMatchObject({
      listing: { refusedSearch: { refusal: 'ref is not valid' } }
    })
  })

  test.each([
    [
      { statusCode: 400, code: null },
      { kind: 'refused', refusal: null }
    ],
    [
      { statusCode: 504, code: 'TIMED_OUT' },
      { kind: 'failed', failure: { kind: 'timed-out' } }
    ],
    [
      { statusCode: 502, code: null },
      { kind: 'failed', failure: { kind: 'errored', upstream: true } }
    ],
    [
      { statusCode: 500, code: null },
      { kind: 'failed', failure: { kind: 'errored' } }
    ],
    [
      { statusCode: 503, code: 'CW_UNREACHABLE' },
      { kind: 'failed', failure: { kind: 'cw-not-reached' } }
    ]
  ])('a later page that stopped with %j reads as %j', async (stopped, read) => {
    vi.mocked(queryList).mockResolvedValue({
      shell,
      bucket: 'gas.outbox',
      list: pages({ stopped: { cursor: 'c2', ...stopped } })
    })

    await expect(listBucketUseCase(ask)).resolves.toMatchObject({
      listing: { stopped: { cursor: 'c2', read } }
    })
  })

  test('a range that can’t be read: the address checked and nothing read', async () => {
    vi.mocked(queryList).mockResolvedValue({
      shell,
      bucket: 'gas.outbox',
      list: null
    })

    await expect(listBucketUseCase({ ...ask, window: null })).resolves.toEqual({
      kind: 'checked',
      bucket: 'gas.outbox'
    })
  })

  test.each([
    ['ADDRESS_REFUSED', 'address'],
    ['RANGE_REFUSED', 'range']
  ])('GAS’s %s is the %s refused', async (code, refusal) => {
    vi.mocked(queryList).mockRejectedValue(
      gasAnswer(400, { code, bucket: 'gas.outbox' })
    )

    await expect(listBucketUseCase(ask)).resolves.toEqual({
      kind: 'refused',
      bucket: 'gas.outbox',
      refusal
    })
  })

  test.each([
    [404, 'LIST_NOT_FOUND', 'not-found'],
    [503, 'CW_UNREACHABLE', 'cw-unreachable']
  ])('a %i %s is no list at the path', async (statusCode, code, kind) => {
    vi.mocked(queryList).mockRejectedValue(gasAnswer(statusCode, { code }))

    await expect(listBucketUseCase(ask)).resolves.toEqual({ kind })
  })

  test('any other 400 is GAS refusing what was asked, with its reason', async () => {
    vi.mocked(queryList).mockRejectedValue(
      gasAnswer(400, { message: '"ref" is not allowed' })
    )

    await expect(listBucketUseCase(ask)).resolves.toEqual({
      kind: 'listed',
      bucket: null,
      listing: {
        read: { kind: 'refused', refusal: '"ref" is not allowed' },
        refusedSearch: null,
        pageRows: [],
        stopped: null
      }
    })
  })

  test.each([
    [gasAnswer(504, {}), { kind: 'timed-out' }],
    [gasAnswer(404, {}), { kind: 'refused', statusCode: 404, errorCode: null }],
    [Boom.gatewayTimeout('Client request timeout'), { kind: 'no-answer' }]
  ])('a failed read is the list failing: %s', async (error, failure) => {
    vi.mocked(queryList).mockRejectedValue(error)

    await expect(listBucketUseCase(ask)).resolves.toMatchObject({
      kind: 'listed',
      bucket: null,
      listing: { read: { kind: 'failed', failure } }
    })
  })
})

describe('what listBucketUseCase asks GAS', () => {
  beforeEach(() => {
    vi.mocked(queryList).mockResolvedValue({
      shell,
      bucket: 'gas.outbox',
      list: pages()
    })
  })

  test('the facts as typed, without the range, the place or a retired switch', async () => {
    await listBucketUseCase({
      ...ask,
      address: {
        status: 'DEAD_LETTER',
        grant: ['a', 'b'],
        from: '2026-11-01',
        to: '2026-11-02',
        range: '24h',
        clear: 'all',
        audit: '1',
        unset: undefined
      }
    })

    expect(asked()?.params).toEqual({
      status: 'DEAD_LETTER',
      grant: ['a', 'b']
    })
  })

  test('the range as the instants it was read as', async () => {
    await listBucketUseCase({
      ...ask,
      window: { from: '2026-11-01T00:00:00.000Z' }
    })

    expect(asked()).toMatchObject({ from: '2026-11-01T00:00:00.000Z' })
    expect(asked()).not.toHaveProperty('read')
  })

  test('a range that can’t be read is checked, and nothing read', async () => {
    await listBucketUseCase({ ...ask, window: null })

    expect(asked()).toMatchObject({ read: false })
    expect(asked()).not.toHaveProperty('from')
  })

  test('a browse asks for no search', async () => {
    await listBucketUseCase({ ...ask, search: { q: '', repeat: true } })

    expect(asked()).toMatchObject({ search: null, repeat: true })
  })

  test('a later page is not counted, and never a repeat', async () => {
    await listBucketUseCase({ ...ask, place: { cursor: 'c2' } })

    expect(asked()).toMatchObject({
      cursor: 'c2',
      count: false,
      repeat: false
    })
    expect(asked()).not.toHaveProperty('pages')
  })

  test('every page an address restores is counted from the first, and was shown before', async () => {
    await listBucketUseCase({ ...ask, place: { through: 3 } })

    expect(asked()).toMatchObject({ pages: 3, count: true, repeat: true })
    expect(asked()).not.toHaveProperty('cursor')
  })
})
