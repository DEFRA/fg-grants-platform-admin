import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { downloadExploreUseCase } from '../use-cases/download-explore.use-case.ts'
import type { ExploreAnswer } from '../use-cases/explore-calls.ts'
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

const csvAnswer: ExploreAnswer = {
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'exact',
  columns: [
    { key: 'c0', label: 'Reference', kind: 'text', aggregate: false },
    { key: 'c1', label: 'Land parcel', kind: 'text', aggregate: false },
    { key: 'c2', label: 'Total area (ha)', kind: 'number', aggregate: true },
    { key: 'c3', label: 'Created', kind: 'date', aggregate: false },
    { key: 'c4', label: 'Business name', kind: 'text', aggregate: false }
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

  test('says in its name when GAS marks it partial', async () => {
    vi.mocked(downloadExploreUseCase).mockResolvedValue({
      kind: 'file',
      answer: { ...csvAnswer, partial: true }
    })

    const { headers } = await download()

    expect(headers['content-disposition']).toBe(
      'attachment; filename="explore-applications-partial.csv"'
    )
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
