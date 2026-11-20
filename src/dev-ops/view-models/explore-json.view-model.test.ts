import { BSON, EJSON, Int32, ObjectId } from 'bson'
import type { IncomingMessage } from 'node:http'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import { streamFromGas } from '../../common/gas.ts'
import { logger } from '../../common/logger.ts'
import { LineTooLongError } from '../../common/lines.ts'
import {
  ExploreStreamError,
  streamExploreQuery
} from '../repositories/explore.repository.ts'
import type {
  ExploreStreamHeader,
  ExploreStreamLine,
  ExploreStreamRow
} from '../repositories/explore.repository.ts'
import {
  toJsonFile,
  toJsonFilename,
  toJsonStream
} from './explore-json.view-model.ts'

vi.mock(import('../../common/gas.ts'))
vi.mock(import('../../common/logger.ts'))

const hex = '6741a0c2e4b0f1a2b3c4d5e6'

const base64 = (document: object): string =>
  Buffer.from(BSON.serialize(document)).toString('base64')

const idOf = (id: unknown) => base64({ _id: id })

const header: ExploreStreamHeader = {
  source: { name: 'applications', noun: 'application' },
  download: { rows: 5000 }
}

const row = (
  doc: object | null,
  extra: Partial<ExploreStreamRow> = {}
): ExploreStreamLine => ({
  row: {
    open: null,
    id: idOf(new ObjectId(hex)),
    doc: doc && base64(doc),
    context: null,
    docNote: null,
    ...extra
  }
})

const end = (stopped: null | 'rows' = null): ExploreStreamLine => ({
  end: { stopped, searchedTo: null, skipped: [] }
})

const linesOf = async function* (
  lines: ExploreStreamLine[],
  breakWith: Error | null = null
) {
  yield* lines

  if (breakWith) {
    throw breakWith
  }
}

const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

const fileOf = async (
  lines: AsyncIterable<ExploreStreamLine>
): Promise<string> => {
  let text = ''

  for await (const part of toJsonFile(header, lines)) {
    text += part
  }

  return text
}

const parsed = async (lines: AsyncIterable<ExploreStreamLine>) =>
  EJSON.parse(await fileOf(lines), { relaxed: false }) as Record<
    string,
    unknown
  >[]

const brokenEnd = {
  $explore: {
    stopped: 'error',
    searchedTo: null,
    skipped: [],
    text: 'Stopped early, as a later part of the search couldn’t be read. Run a narrower query for the rest.'
  }
}

describe('toJsonFile', () => {
  test('writes each row’s document whole, as canonical Extended JSON in one shape, then where it ended', async () => {
    const text = await fileOf(
      linesOf([
        row({ _id: new ObjectId(hex), n: 1, document: 'x' }),
        row({ n: 2 }, { docNote: { changed: true } }),
        end()
      ])
    )

    expect(text).toBe(
      [
        '[',
        `{"document":{"_id":{"$oid":"${hex}"},"n":{"$numberInt":"1"},"document":"x"},"context":null,"note":null},`,
        '{"document":{"n":{"$numberInt":"2"}},"context":null,"note":{"changed":true}},',
        '{"$explore":{"stopped":null,"searchedTo":null,"skipped":[],"text":null}}',
        ']',
        ''
      ].join('\n')
    )
  })

  test('names a record gone since it was found by its _id', async () => {
    const items = await parsed(
      linesOf([row(null, { docNote: { gone: true } }), end()])
    )

    expect(items[0]).toEqual({
      document: null,
      context: null,
      note: { gone: true, _id: new ObjectId(hex) }
    })
  })

  test('keeps what of a row can be read, names what can’t by its _id, and goes on, logging no value and once a file', async () => {
    const items = await parsed(
      linesOf([
        row({ n: 1 }),
        {
          row: {
            ...(row(null) as { row: ExploreStreamRow }).row,
            doc: 'AAAA',
            id: idOf('WMP-1'),
            context: { service: 'GAS', box: 'outbox' }
          }
        },
        row(
          { n: 3 },
          { context: { definition: 'AAAA' }, docNote: { changed: true } }
        ),
        end()
      ])
    )

    expect(items).toHaveLength(4)
    expect(items[1]).toEqual({
      document: null,
      context: { service: 'GAS', box: 'outbox' },
      note: { unreadable: ['document'], _id: 'WMP-1' }
    })
    expect(items[2]).toEqual({
      document: { n: new Int32(3) },
      context: null,
      note: { changed: true, unreadable: ['context'], _id: new ObjectId(hex) }
    })
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Explore JSON download: 2 rows with a part not readable as BSON: BSONOffsetError'
    )
  })

  test('names an _id it can’t read among what it couldn’t read, counted and logged as the rest', async () => {
    const items = await parsed(
      linesOf([row(null, { id: 'AAAA', docNote: { gone: true } }), end()])
    )

    expect(items[0]).toEqual({
      document: null,
      context: null,
      note: { gone: true, unreadable: ['_id'], _id: null }
    })
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Explore JSON download: 1 rows with a part not readable as BSON: BSONOffsetError'
    )
  })

  test('writes one gone item for a Show it whose document was gone when fetched: its row’s', async () => {
    const show = {
      id: idOf(new ObjectId(hex)),
      at: [],
      service: null,
      box: null
    }
    let text = ''

    for await (const part of toJsonFile(
      { ...header, documents: { whole: true, gone: true } },
      linesOf([row(null, { docNote: { gone: true } }), end()]),
      show
    )) {
      text += part
    }

    expect(EJSON.parse(text, { relaxed: false })).toEqual([
      {
        document: null,
        context: null,
        note: { gone: true, _id: new ObjectId(hex) }
      },
      {
        $explore: { stopped: null, searchedTo: null, skipped: [], text: null }
      }
    ])
  })

  test('names a Show it’s record by its _id when GAS says it is gone, and sends no row', async () => {
    const show = {
      id: idOf(new ObjectId(hex)),
      at: [],
      service: 'CW' as const,
      box: 'inbox' as const
    }
    let text = ''

    for await (const part of toJsonFile(
      { ...header, documents: { whole: true, gone: true } },
      linesOf([end()]),
      show
    )) {
      text += part
    }

    expect(EJSON.parse(text, { relaxed: false })).toEqual([
      {
        document: null,
        context: { service: 'CW', box: 'inbox' },
        note: { gone: true, _id: new ObjectId(hex) }
      },
      {
        $explore: { stopped: null, searchedTo: null, skipped: [], text: null }
      }
    ])
  })

  test('says which limit stopped it, how far back it searched, and the records too large to search by their _id', async () => {
    const items = await parsed(
      linesOf([
        row({ n: 1 }),
        {
          end: {
            stopped: 'rows',
            searchedTo: '2026-09-01T00:00:00.000Z',
            skipped: [
              { open: null, id: idOf(new ObjectId(hex)) },
              { open: null, id: idOf('WMP-1') },
              { open: null, id: 'AAAA' }
            ]
          }
        }
      ])
    )

    expect(items.at(-1)).toEqual({
      $explore: {
        stopped: 'rows',
        searchedTo: '2026-09-01T00:00:00.000Z',
        skipped: [new ObjectId(hex), 'WMP-1', null],
        text: 'Stopped at the 5,000-row limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest.'
      }
    })
  })

  test('writes an event’s service and box, and a joined record as stored', async () => {
    const items = await parsed(
      linesOf([
        row({ n: 1 }, { context: { service: 'CW', box: 'inbox' } }),
        row(
          { n: 2 },
          { context: { definition: base64({ version: '1.2.0' }) } }
        ),
        row({ n: 3 }, { context: { agreement: null } }),
        end()
      ])
    )

    expect(items.slice(0, 3).map(({ context }) => context)).toEqual([
      { service: 'CW', box: 'inbox' },
      { definition: { version: '1.2.0' } },
      { agreement: null }
    ])
  })

  test.each([
    [
      'breaks after some rows',
      linesOf([row({ n: 1 })], reset),
      'Error ECONNRESET'
    ],
    ['ends with no end line', linesOf([row({ n: 1 })]), 'MissingEndError'],
    [
      'sends a line too long',
      linesOf([row({ n: 1 })], new LineTooLongError()),
      'LineTooLongError'
    ],
    [
      'sends a line that isn’t GAS’s',
      linesOf(
        [row({ n: 1 })],
        new ExploreStreamError('Explore stream line of no kind')
      ),
      'ExploreStreamError'
    ]
  ])(
    'closes the file with "stopped": "error" when the stream %s, the rows before it standing, logging only what kind of break it was',
    async (_, lines, kind) => {
      const items = await parsed(lines)

      expect(items).toHaveLength(2)
      expect(items[0]).toMatchObject({ document: { n: new Int32(1) } })
      expect(items[1]).toEqual(brokenEnd)
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        `Explore JSON download stopped early: ${kind}`
      )
    }
  )

  test('is a whole JSON array even with no rows', async () => {
    expect(await parsed(linesOf([end()]))).toHaveLength(1)
  })

  test('names the file by its source', () => {
    expect(toJsonFilename({ name: 'applications', noun: 'application' })).toBe(
      'explore-applications.json'
    )
  })
})

describe('toJsonStream', () => {
  let gc: () => void

  beforeAll(() => {
    setFlagsFromString('--expose-gc')
    gc = runInNewContext('gc') as () => void
  })

  /** What the process holds in its heap and in buffers. */
  const held = () => {
    const { heapUsed, arrayBuffers } = process.memoryUsage()

    return heapUsed + arrayBuffers
  }

  /** GAS's lines, made one at a time as they are read: a 15 MiB document a row. */
  const gasStream = (rows: number, line: string) =>
    Readable.from(
      (function* () {
        yield `${JSON.stringify({ header })}\n`

        for (let n = 0; n < rows; n += 1) {
          yield `${line}\n`
        }

        yield `${JSON.stringify(end())}\n`
      })(),
      { objectMode: false, highWaterMark: 1 }
    )

  test('pipes a file of 15 MiB documents from GAS’s stream, holding one row’s line, bytes and JSON at a time, not the file', async () => {
    const parts = Array.from({ length: 15 }, (_, n) => [
      `p${n}`,
      'x'.repeat(1024 * 1024)
    ])
    const line = JSON.stringify(row(Object.fromEntries(parts)))
    const rows = 30

    vi.mocked(streamFromGas).mockResolvedValue(
      gasStream(rows, line) as unknown as IncomingMessage
    )

    const stream = await streamExploreQuery({ query: 'q' })

    gc()

    const before = held()
    let peak = 0
    let written = 0
    let chunks = 0

    await pipeline(
      toJsonStream(stream.header, stream.lines),
      new Writable({
        write(chunk: Buffer, _, done) {
          written += chunk.length
          chunks += 1

          if (chunks % 2 === 0) {
            gc()
            peak = Math.max(peak, held() - before)
          }

          done()
        }
      })
    )

    expect(written).toBeGreaterThan(rows * 15 * 1024 * 1024)
    expect(peak).toBeLessThan(12 * 15 * 1024 * 1024)
  }, 60_000)
})
