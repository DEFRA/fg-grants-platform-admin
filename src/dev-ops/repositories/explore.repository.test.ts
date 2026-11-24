import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { config } from '../../common/config.ts'
import { getFromGas, postToGas, streamFromGas } from '../../common/gas.ts'
import { LineTooLongError } from '../../common/lines.ts'
import {
  checkExplore,
  ExploreStreamError,
  findVocabulary,
  queryExplore,
  streamExploreQuery
} from './explore.repository.ts'
import type { ExploreStreamLine } from './explore.repository.ts'

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

describe('streamExploreQuery', () => {
  const header = {
    header: {
      source: { name: 'applications', noun: 'application' },
      download: { rows: 5000 }
    }
  }
  const row = {
    row: {
      open: null,
      id: null,
      doc: null,
      context: null,
      docNote: { gone: true }
    }
  }
  const end = { end: { stopped: null, searchedTo: null, skipped: [] } }

  const responding = (...parts: string[]) => {
    const response = Readable.from(parts)

    vi.mocked(streamFromGas).mockResolvedValue(
      response as unknown as IncomingMessage
    )

    return response
  }

  const lineOf = (value: unknown) => `${JSON.stringify(value)}\n`

  const all = async (lines: AsyncIterable<ExploreStreamLine>) => {
    const read: ExploreStreamLine[] = []

    for await (const line of lines) {
      read.push(line)
    }

    return read
  }

  test('asks GAS to stream the download, letting go of a body that stops coming after GAS’s own deadline', async () => {
    responding(lineOf(header))

    await streamExploreQuery({ query: 'db.cases.find()', positions: 'p' })

    expect(streamFromGas).toHaveBeenCalledExactlyOnceWith(
      '/grant-admin/explore/query',
      {
        payload: {
          query: 'db.cases.find()',
          positions: 'p',
          csv: true,
          documents: true,
          stream: true
        },
        timeoutMs: config.get('gas.exploreTimeoutMs'),
        idleMs: config.get('gas.exploreTimeoutMs')
      }
    )
  })

  test('reads the header before answering, then the rows and the end as they come', async () => {
    responding(
      lineOf(header),
      lineOf(row).slice(0, 10),
      lineOf(row).slice(10),
      lineOf(end)
    )

    const stream = await streamExploreQuery({ query: 'q' })

    expect(stream.header).toEqual(header.header)
    expect(await all(stream.lines)).toEqual([row, end])
  })

  test.each([
    ['no line at all', []],
    ['a row first', [lineOf(row)]],
    ['a line that isn’t JSON', ['nope\n']]
  ])(
    'refuses a stream that starts with %s, and lets it go',
    async (_, parts) => {
      const response = responding(...(parts as string[]))

      await expect(streamExploreQuery({ query: 'q' })).rejects.toThrow(
        /Explore stream|JSON/
      )
      expect(response.destroyed).toBe(true)
    }
  )

  test.each([
    ['a line of no kind', lineOf({ other: 1 })],
    ['a second header', lineOf(header)],
    ['a line of two kinds', lineOf({ row: {}, end: {} })]
  ])('breaks at %s', async (_, line) => {
    responding(lineOf(header), lineOf(row), line)

    const { lines } = await streamExploreQuery({ query: 'q' })

    await expect(all(lines)).rejects.toThrow(ExploreStreamError)
  })

  test('reads a line of 44 MiB, a document and its joined record, and breaks past it', async () => {
    const big = { row: { ...row.row, doc: 'A'.repeat(43 * 1024 * 1024) } }
    responding(lineOf(header), lineOf(big), 'x'.repeat(45 * 1024 * 1024))

    const { lines } = await streamExploreQuery({ query: 'q' })
    const iterator = lines[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toEqual(big)
    await expect(iterator.next()).rejects.toThrow(LineTooLongError)
  }, 30_000)
})
