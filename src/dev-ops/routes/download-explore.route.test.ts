import { BSON, ObjectId } from 'bson'
import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  downloadExploreUseCase,
  downloadJsonUseCase
} from '../use-cases/download-explore.use-case.ts'
import type {
  ExploreAnswer,
  ExploreStreamLine
} from '../use-cases/explore-calls.ts'
import type { ExplorePageData } from '../use-cases/explore-page.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/download-explore.use-case.ts'))
vi.mock(import('../use-cases/shell-catalogue.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'

const q = 'db.applications.find()'

/** A record's `_id` as GAS sends it: base64 BSON of `{ _id }`. */
const idOf = (_id: unknown) =>
  Buffer.from(BSON.serialize({ _id })).toString('base64')

/** The file's last lines, before the line end that closes it. */
const lastLinesOf = (payload: string, n: number) =>
  payload.split('\r\n').slice(-n - 1, -1)

const csvAnswer: ExploreAnswer = {
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'exact',
  columns: [
    {
      key: 'c0',
      label: 'Reference',
      kind: 'text',
      aggregate: false,
      path: null
    },
    {
      key: 'c1',
      label: 'Land parcel',
      kind: 'text',
      aggregate: false,
      path: null
    },
    {
      key: 'c2',
      label: 'Total area (ha)',
      kind: 'number',
      aggregate: true,
      path: null
    },
    { key: 'c3', label: 'Created', kind: 'date', aggregate: false, path: null },
    {
      key: 'c4',
      label: 'Business name',
      kind: 'text',
      aggregate: false,
      path: null
    }
  ],
  rows: [
    {
      open: null,
      cells: {
        c0: 'wmp-aa1-bb2',
        c1: ['SX1', ['SX2', 'SX3']],
        c2: 1860.5,
        c3: '2026-10-13T14:53:00.000Z',
        c4: '=HYPERLINK("x")'
      }
    },
    {
      open: null,
      cells: { c0: '@sum', c1: [], c2: -3, c3: null, c4: 'A, "B"' }
    }
  ],
  count: { n: 2, capped: false },
  groups: false,
  unwound: false,
  partial: false,
  window: null,
  unseen: []
}

const page = (overrides: Partial<ExplorePageData>): ExplorePageData => ({
  q,
  run: null,
  result: null,
  previous: null,
  notice: null,
  recent: [],
  vocabulary: null,
  ...overrides
})

let server: Server

const download = async (headers: Record<string, string> = {}) => {
  const response = await server.inject({
    method: 'POST',
    url: '/dev-ops/explore.csv',
    payload: { run: id },
    auth: { strategy: 'session', credentials },
    headers: { 'sec-fetch-site': 'same-origin', ...headers }
  })

  return { ...response, $: load(response.payload) }
}

/** The alert's words, one element's text kept apart from the next. */
const alertOf = ($: ReturnType<typeof load>) =>
  load(($('[data-testid="explore-alert"]').html() ?? '').replace(/></g, '> <'))
    .text()
    .replace(/\s+/g, ' ')
    .trim()

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(downloadExploreUseCase).mockResolvedValue({
    kind: 'file',
    answer: csvAnswer
  })
})

afterAll(async () => {
  await server.stop()
})

describe('Download CSV', () => {
  test('asks the use case for the run alone, as this session and user', async () => {
    await download()

    expect(downloadExploreUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: { session: expect.any(String), user: credentials.user.id },
      run: id
    })
  })

  test('is the run’s columns and rows: ISO dates, raw numbers, lists joined, inner lists in brackets, formulas made text', async () => {
    const { payload, headers, statusCode } = await download()

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(headers['content-disposition']).toBe(
      'attachment; filename="explore-applications.csv"'
    )
    expect(headers['cache-control']).toBe('no-store')
    expect(payload).toBe(
      [
        'Reference,Land parcel,Total area (ha),Created,Business name',
        'wmp-aa1-bb2,"SX1; [SX2, SX3]",1860.5,2026-10-13T14:53:00.000Z,"\'=HYPERLINK(""x"")"',
        '\'@sum,[],-3,,"A, ""B"""',
        ''
      ].join('\r\n')
    )
  })

  test('writes an object whole, as GAS wrote it inline', async () => {
    const plan = "{ reference: 'WMP-2431', parcels: [ { id: '2210' } ] }"

    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: {
        ...csvAnswer,
        columns: [csvAnswer.columns[0]],
        rows: [{ open: null, cells: { c0: { text: plan } } }]
      }
    })

    const { payload } = await download()

    expect(payload).toBe(`Reference\r\n"${plan}"\r\n`)
  })

  test.each([
    [
      'its rows, by the limit it ran with',
      'rows',
      'explore-applications-stopped-at-4000-rows.csv',
      '"# Stopped at the 4,000-row limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest."'
    ],
    [
      'its time',
      'time',
      'explore-applications-stopped-at-time-limit.csv',
      '# Stopped at the 10-second time limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest.'
    ],
    [
      'its windows',
      'windows',
      'explore-applications-stopped-at-50-windows.csv',
      '# Stopped at the 50-window limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest.'
    ],
    [
      'its size',
      'bytes',
      'explore-applications-stopped-at-size-limit.csv',
      '# Stopped at the 256 MiB size limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest.'
    ],
    [
      'a later window it couldn’t read',
      'error',
      'explore-applications-stopped-early.csv',
      '"# Stopped early, as a later part of the search couldn’t be read: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest."'
    ]
  ] as const)(
    'says it stopped at %s in its name and its last row',
    async (_, stopped, name, last) => {
      vi.mocked(downloadExploreUseCase).mockResolvedValue({
        kind: 'file',
        answer: {
          ...csvAnswer,
          partial: true,
          download: {
            rows: 4000,
            stopped,
            searchedTo: '2026-09-01T00:00:00.000Z'
          }
        }
      })

      const { headers, payload } = await download()

      expect(headers['content-disposition']).toBe(
        `attachment; filename="${name}"`
      )
      expect(lastLinesOf(payload, 1)).toEqual([last])
    }
  )

  test('names the row limit it ran with, a typed one included', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: {
        ...csvAnswer,
        download: { rows: 200, stopped: 'rows', searchedTo: null }
      }
    })

    const { headers } = await download()

    expect(headers['content-disposition']).toBe(
      'attachment; filename="explore-applications-stopped-at-200-rows.csv"'
    )
  })

  test('says where it stopped without how far back when GAS doesn’t know', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: {
        ...csvAnswer,
        download: { rows: 5000, stopped: 'rows', searchedTo: null }
      }
    })

    const { payload } = await download()

    expect(lastLinesOf(payload, 1)).toEqual([
      '"# Stopped at the 5,000-row limit. Run a narrower query for the rest."'
    ])
  })

  test('names nothing it didn’t stop at, and ends with its last row', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: {
        ...csvAnswer,
        download: { rows: 4000, stopped: null, searchedTo: null }
      }
    })

    const { headers, payload } = await download()

    expect(headers['content-disposition']).toBe(
      'attachment; filename="explore-applications.csv"'
    )
    expect(lastLinesOf(payload, 1)).toEqual(['\'@sum,[],-3,,"A, ""B"""'])
  })

  test('lists the records too large to search by their _id, before where it stopped', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: {
        ...csvAnswer,
        read: 'windowed',
        count: null,
        window: {
          to: '2026-09-01T00:00:00.000Z',
          end: false,
          positions: null,
          skipped: [
            { open: null, id: idOf(new ObjectId('6741a0c2e4b0f1a2b3c4d5e6')) },
            { open: null, id: idOf("WMP-it's") }
          ]
        },
        download: {
          rows: 4000,
          stopped: 'time',
          searchedTo: '2026-09-01T00:00:00.000Z'
        }
      }
    })

    const { payload } = await download()

    expect(lastLinesOf(payload, 2)).toEqual([
      `"# 2 records too large to search, which may or may not match: ObjectId('6741a0c2e4b0f1a2b3c4d5e6'), 'WMP-it\\'s'"`,
      '# Stopped at the 10-second time limit: searched back to 2026-09-01T00:00:00.000Z. Run a narrower query for the rest.'
    ])
  })

  test('says a run the use case no longer holds has expired', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'page',
      page: page({ q: '', notice: { kind: 'expired' } })
    })

    const { $, statusCode, headers } = await download()

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect(alertOf($)).toBe('This query has expired. Run it again.')
  })

  test('says why on the page when it can’t be read, with the run’s query in the editor', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'page',
      page: page({
        run: { id, page: 1 },
        result: {
          outcome: 'failed',
          failure: { kind: 'errored', service: 'GAS' }
        }
      })
    })

    const { $, statusCode } = await download()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(alertOf($)).toContain(
      'The Grant Application Service answered with an error.'
    )
    expect($('#q').val()).toBe(q)
  })

  test.each([
    [{}],
    [{ 'sec-fetch-site': 'same-site' }],
    [{ origin: 'https://other.cdp-int.defra.cloud' }]
  ])('is refused from another site, and reads nothing: %o', async (headers) => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/dev-ops/explore.csv',
      payload: { run: id },
      auth: { strategy: 'session', credentials },
      headers
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(downloadExploreUseCase).not.toHaveBeenCalled()
  })

  test.each([[{}], [{ run: 'not-a-run' }]])(
    'refuses a post that names no run: %o',
    async (payload) => {
      const { statusCode } = await server.inject({
        method: 'POST',
        url: '/dev-ops/explore.csv',
        payload,
        auth: { strategy: 'session', credentials },
        headers: { 'sec-fetch-site': 'same-origin' }
      })

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(downloadExploreUseCase).not.toHaveBeenCalled()
    }
  )
})

describe('Download JSON', () => {
  const header = {
    source: { name: 'applications', noun: 'application' },
    download: { rows: 5000 }
  }

  const lines = async function* (): AsyncGenerator<ExploreStreamLine> {
    yield {
      row: {
        open: null,
        id: idOf(new ObjectId('6741a0c2e4b0f1a2b3c4d5e6')),
        doc: Buffer.from(BSON.serialize({ n: 1 })).toString('base64'),
        context: null,
        docNote: null
      }
    }
    yield { end: { stopped: 'time', searchedTo: null, skipped: [] } }
  }

  const downloadJson = async (
    headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
    payload: object = { run: id }
  ) =>
    server.inject({
      method: 'POST',
      url: '/dev-ops/explore.json',
      payload,
      auth: { strategy: 'session', credentials },
      headers
    })

  test('sends the run’s documents as a JSON attachment, never kept, as they are read', async () => {
    vi.mocked(downloadJsonUseCase).mockResolvedValue({
      kind: 'lines',
      header,
      lines: lines(),
      show: null
    })

    const { statusCode, headers, payload } = await downloadJson()

    expect(downloadJsonUseCase).toHaveBeenCalledExactlyOnceWith({
      owner: expect.objectContaining({ user: credentials.user.id }),
      run: id
    })
    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['content-type']).toBe('application/json; charset=utf-8')
    expect(headers['content-disposition']).toBe(
      'attachment; filename="explore-applications.json"'
    )
    expect(headers['cache-control']).toBe('no-store')
    expect(JSON.parse(payload)).toEqual([
      { document: { n: { $numberInt: '1' } }, context: null, note: null },
      {
        $explore: {
          stopped: 'time',
          searchedTo: null,
          skipped: [],
          text: 'Stopped at the 10-second time limit. Run a narrower query for the rest.'
        }
      }
    ])
  })

  test('says a run the use case no longer holds has expired', async () => {
    vi.mocked(downloadJsonUseCase).mockResolvedValue({
      kind: 'page',
      page: page({ q: '', notice: { kind: 'expired' } })
    })

    const { statusCode, payload } = await downloadJson()

    expect(statusCode).toBe(statusCodes.ok)
    expect(alertOf(load(payload))).toBe('This query has expired. Run it again.')
  })

  test('says why GAS refused it, on the run’s page', async () => {
    vi.mocked(downloadJsonUseCase).mockResolvedValue({
      kind: 'page',
      page: page({
        run: { id, page: 1, view: 'documents' },
        result: {
          outcome: 'failed',
          failure: { kind: 'errored', service: 'GAS' }
        }
      })
    })

    const { statusCode, payload } = await downloadJson()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(alertOf(load(payload))).toContain(
      'The Grant Application Service answered with an error.'
    )
  })

  test.each([
    [{ 'sec-fetch-site': 'cross-site' }],
    [{ origin: 'https://other.cdp-int.defra.cloud' }]
  ])('is refused from another site, and reads nothing: %o', async (headers) => {
    const { statusCode } = await downloadJson(headers)

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(downloadJsonUseCase).not.toHaveBeenCalled()
  })

  test.each([[{}], [{ run: 'not-a-run' }], [{ run: id, view: 'documents' }]])(
    'refuses a post that is anything but a run: %o',
    async (payload) => {
      const { statusCode } = await downloadJson(undefined, payload)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(downloadJsonUseCase).not.toHaveBeenCalled()
    }
  )
})
