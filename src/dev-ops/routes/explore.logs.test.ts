import Boom from '@hapi/boom'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  ExploreAnswer,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore
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
  payload?: Record<string, string>
) => {
  const { headers } = await server.inject({
    method,
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: { cookie, 'sec-fetch-site': 'same-origin' }
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
