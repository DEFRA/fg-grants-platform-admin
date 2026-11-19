import { config } from '../../common/config.ts'
import { getFromGas, postToGas } from '../../common/gas.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore
} from './explore.repository.ts'

vi.mock(import('../../common/gas.ts'))

describe('queryExplore', () => {
  test('posts the query and its positions to GAS, and nothing more, waiting past GAS’s own deadline', async () => {
    vi.mocked(postToGas).mockResolvedValue({ rows: [] })

    await queryExplore({ query: 'db.cases.find()', positions: 'p' })

    expect(postToGas).toHaveBeenCalledExactlyOnceWith(
      '/grant-admin/explore/query',
      {
        payload: {
          query: 'db.cases.find()',
          positions: 'p'
        },
        timeoutMs: config.get('gas.exploreTimeoutMs')
      }
    )
    expect(config.get('gas.exploreTimeoutMs')).toBeGreaterThan(10000)
  })

  test('asks for windows 1 to N as one answer', async () => {
    vi.mocked(postToGas).mockResolvedValue({ rows: [] })

    await queryExplore({ query: 'db.cases.find()', windows: 3 })

    expect(vi.mocked(postToGas).mock.calls[0][1]?.payload).toEqual({
      query: 'db.cases.find()',
      windows: 3
    })
  })
})

describe('checkExplore', () => {
  test('asks GAS only to check the query', async () => {
    vi.mocked(postToGas).mockResolvedValue({ ok: true, vocabulary: null })

    expect(await checkExplore('db.cases.find()')).toEqual({
      ok: true,
      vocabulary: null
    })
    expect(postToGas).toHaveBeenCalledExactlyOnceWith(
      '/grant-admin/explore/query',
      { payload: { query: 'db.cases.find()', check: true } }
    )
  })
})

describe('findVocabulary', () => {
  test('reads GAS’s sources and fields', async () => {
    vi.mocked(getFromGas).mockResolvedValue({ sources: [] })

    expect(await findVocabulary()).toEqual({ sources: [] })
    expect(getFromGas).toHaveBeenCalledExactlyOnceWith(
      '/grant-admin/explore/vocabulary'
    )
  })
})
