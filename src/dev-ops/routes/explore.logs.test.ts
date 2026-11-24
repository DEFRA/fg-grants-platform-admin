import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'
import { BSON, ObjectId } from 'bson'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  ExploreAnswer,
  ExploreStreamLine,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore,
  streamExploreQuery
} from '../repositories/explore.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../repositories/explore.repository.ts'))
vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/lists.repository.ts'))
// Every line the app logs, request logs from hapi-pino included, kept to read back.
vi.mock(import('../../common/logger.ts'), async () => {
  const { pino } = await import('pino')
  const lines: string[] = []

  return {
    logger: pino(
      { level: 'trace' },
      { write: (line: string) => lines.push(line) }
    ),
    lines
  } as never
})

const { lines } = (await import('../../common/logger.ts')) as unknown as {
  lines: string[]
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

/** A value nobody would type, so finding it anywhere means it leaked. */
const sentinel = 'Zq7Sentinel9Xv'

/** An `_id` nobody would hold, as hex. */
const idSentinel = 'f00dfacecafe5e9b1c3d5f70'

const query = `db.applications.find({ _id: ObjectId('${idSentinel}'), 'phases.answers.applicant.business.name': '${sentinel}' })`

const responseError = (statusCode: number, body: object) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

const answer = (
  overrides: Partial<ExploreAnswer & WithVocabulary> = {}
): ExploreAnswer & WithVocabulary => ({
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'windowed',
  columns: [
    {
      key: 'c0',
      label: 'Business name',
      kind: 'text',
      aggregate: false,
      path: null
    },
    { key: 'c1', label: 'SBI', kind: 'text', aggregate: false, path: null }
  ],
  rows: [
    {
      open: { kind: 'application', code: 'woodland', ref: 'wmp-aa1-bb2' },
      cells: { c0: sentinel, c1: sentinel }
    }
  ],
  count: null,
  groups: false,
  unwound: false,
  partial: false,
  unseen: [],
  window: {
    to: '2026-10-01T00:00:00.000Z',
    end: false,
    positions: sentinel,
    skipped: []
  },
  vocabulary: null,
  ...overrides
})

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const inject = async (
  method: 'GET' | 'POST',
  url: string,
  cookie: string,
  payload?: Record<string, string>,
  extra: Record<string, string> = {}
) => {
  const { headers } = await server.inject({
    method,
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: { cookie, 'sec-fetch-site': 'same-origin', ...extra }
  })

  return {
    location: headers.location ?? '',
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  lines.length = 0
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(queryList).mockImplementation(async ({ path }) => ({
    shell: { catalogue: fullCatalogue },
    bucket:
      fullCatalogue.buckets.find((bucket) => bucket.path === path)?.id ?? '',
    list: null
  }))
  vi.mocked(checkExplore).mockResolvedValue({
    ok: true,
    source: 'applications',
    vocabulary: null
  })
  vi.mocked(queryExplore).mockResolvedValue(answer())
  vi.mocked(findVocabulary).mockResolvedValue({ sources: [] })
})

afterAll(async () => {
  await server.stop()
})

describe('a query’s values', () => {
  test('are in no log line and no redirect, through every way in and out', async () => {
    const locations: string[] = []
    const run = await inject('POST', '/dev-ops/explore', '', { q: query })
    const id = new URL(run.location, 'http://x').searchParams.get('run') ?? ''

    locations.push(run.location)

    const shown = await inject('GET', run.location, run.cookie)
    const next = await inject('POST', '/dev-ops/explore', shown.cookie, {
      run: id,
      page: '2'
    })

    await inject('GET', `${run.location}&through=2`, next.cookie)
    await inject('POST', '/dev-ops/explore.csv', next.cookie, { run: id })

    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(500, { message: sentinel })
    )
    await inject('GET', run.location, next.cookie)

    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(400, {
        reason: 'QUERY_REFUSED',
        refusal: 'MONGOD_ERROR',
        message: sentinel,
        error: { message: sentinel, at: 0, end: 1 }
      })
    )
    await inject('GET', run.location, next.cookie)

    vi.mocked(checkExplore).mockRejectedValueOnce(
      responseError(400, {
        reason: 'QUERY_INVALID',
        error: { message: sentinel, at: 0, end: 1 }
      })
    )
    await inject('POST', '/dev-ops/explore', next.cookie, { q: query })
    locations.push(
      (
        await inject('POST', '/dev-ops/explore', next.cookie, {
          pick: 'frps-cases-by-status',
          q: query
        })
      ).location
    )

    locations.push(
      (
        await inject('POST', '/dev-ops/explore', next.cookie, {
          from: 'applications',
          list: `grant=${sentinel}`
        })
      ).location,
      (
        await inject('POST', '/dev-ops/explore', next.cookie, {
          find: 'applications-by-business',
          record: '/dev-ops/applications/woodland/wmp-aa1-bb2'
        })
      ).location
    )

    expect(lines.length).toBeGreaterThan(0)
    expect(
      lines.filter(
        (line) => line.includes(sentinel) || line.includes(idSentinel)
      )
    ).toEqual([])
    expect(locations.every((location) => location.includes('run='))).toBe(true)
    expect(
      locations.filter(
        (location) =>
          location.includes(sentinel) || location.includes(idSentinel)
      )
    ).toEqual([])
  })
})

const base64Of = (document: object): string =>
  Buffer.from(BSON.serialize(document)).toString('base64')

/** A record whose every value is a sentinel, its comments and its `_id` among them. */
const sentinelDocument = {
  _id: new ObjectId(idSentinel),
  clientRef: sentinel,
  comments: [{ text: sentinel, by: sentinel }],
  ref: new ObjectId(idSentinel)
}

const documentRow = {
  open: { kind: 'application' as const, code: 'woodland', ref: 'wmp-aa1-bb2' },
  cells: { c0: sentinel, c1: sentinel },
  id: base64Of({ _id: new ObjectId(idSentinel) }),
  doc: base64Of(sentinelDocument),
  context: { definition: base64Of({ title: sentinel }) },
  docNote: null
}

/** The same record as a Documents page reads it: its start. */
const startRow = {
  open: documentRow.open,
  cells: documentRow.cells,
  id: documentRow.id,
  at: [],
  start: { doc: base64Of(sentinelDocument), cut: false },
  printed: { bytes: 200, values: 6 },
  context: null,
  docNote: null
}

const gasLines = (broken: boolean) => ({
  header: { source: answer().source, download: { rows: 5000 } },
  lines: (async function* (): AsyncGenerator<ExploreStreamLine> {
    yield { row: documentRow }
    yield { row: { ...documentRow, doc: 'AAAA' } }

    if (broken) {
      throw new Error(`socket hang up ${sentinel}`)
    }

    yield {
      end: {
        stopped: null,
        searchedTo: null,
        skipped: [{ open: null, id: documentRow.id }]
      }
    }
  })()
})

describe('a document’s values', () => {
  test('are in no log line and no redirect, in Documents, Show it, an open in place and Download JSON', async () => {
    vi.mocked(queryExplore).mockResolvedValue(
      answer({
        rows: [
          startRow,
          { ...startRow, start: { doc: 'AAAA', cut: false } },
          { ...startRow, start: null, printed: null, docNote: { gone: true } }
        ],
        documents: { whole: true, bytes: 100 }
      })
    )
    const run = await inject('POST', '/dev-ops/explore', '', { q: query })
    const id = new URL(run.location, 'http://x').searchParams.get('run') ?? ''
    const shown = await inject(
      'GET',
      `${run.location}&view=documents`,
      run.cookie
    )
    const shownIt = await inject('POST', '/dev-ops/explore', shown.cookie, {
      run: id,
      show: documentRow.id,
      result: '1',
      at: '0'
    })

    vi.mocked(queryExplore).mockResolvedValue(
      answer({
        rows: [documentRow],
        documents: { whole: true, bytes: 100, gone: false }
      })
    )
    await inject('GET', shownIt.location, shownIt.cookie)

    const open = { run: id, show: documentRow.id, result: '1', at: '0' }
    const opening = { 'x-requested-with': 'gpa-doc-line' }

    await inject('POST', '/dev-ops/explore', shownIt.cookie, open, opening)
    vi.mocked(queryExplore).mockResolvedValueOnce(
      answer({ rows: [{ ...documentRow, doc: 'AAAA' }] })
    )
    await inject('POST', '/dev-ops/explore', shownIt.cookie, open, opening)
    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(500, { message: sentinel })
    )
    await inject('POST', '/dev-ops/explore', shownIt.cookie, open, opening)
    expect(queryExplore).toHaveBeenLastCalledWith(
      expect.objectContaining({ documents: true, show: expect.any(Object) })
    )
    await inject('POST', '/dev-ops/explore', shownIt.cookie, {
      run: id,
      page: '2',
      view: 'documents'
    })

    for (const broken of [false, true]) {
      vi.mocked(streamExploreQuery).mockResolvedValueOnce(gasLines(broken))
      await inject('POST', '/dev-ops/explore.json', shownIt.cookie, { run: id })
    }

    vi.mocked(streamExploreQuery).mockRejectedValueOnce(
      responseError(500, { message: sentinel })
    )
    await inject('POST', '/dev-ops/explore.json', shownIt.cookie, { run: id })

    expect(streamExploreQuery).toHaveBeenCalledTimes(3)
    expect(lines.length).toBeGreaterThan(0)
    expect(
      lines.filter(
        (line) => line.includes(sentinel) || line.includes(idSentinel)
      )
    ).toEqual([])
    expect(shownIt.location).toMatch(
      /^\/dev-ops\/explore\?run=[\w-]+&view=documents$/
    )
  })
})

describe('a Documents page GAS answered with rows it can’t have sent', () => {
  test('logs what was wrong as an error, without the document’s values', async () => {
    vi.mocked(queryExplore).mockResolvedValue(
      answer({
        rows: [
          {
            ...startRow,
            start: { doc: base64Of({ clientRef: sentinel }), cut: true }
          }
        ],
        documents: { whole: true, bytes: 100 }
      })
    )
    const run = await inject('POST', '/dev-ops/explore', '', { q: query })
    const before = lines.length
    await inject('GET', `${run.location}&view=documents`, run.cookie)
    const logged = lines.slice(before).map((line) => JSON.parse(line))

    expect(
      logged.filter(({ level }) => level === 50).map(({ msg }) => msg)
    ).toEqual([
      "fg-gas-backend answered Explore's Documents with a cut start that prints whole"
    ])
    expect(
      logged.filter(
        ({ msg }) => msg?.includes(sentinel) || msg?.includes(idSentinel)
      )
    ).toEqual([])
  })
})
