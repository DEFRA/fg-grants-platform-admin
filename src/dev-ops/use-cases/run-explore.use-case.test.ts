import Boom from '@hapi/boom'
import { BSON, ObjectId } from 'bson'

import type {
  ExploreAnswer,
  ExploreColumn,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  checkExplore,
  findVocabulary,
  queryExplore
} from '../repositories/explore.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import type { ListLook } from './explore-queries.ts'
import { findLiveRun, recentQueries } from './held-runs.ts'
import { runExploreUseCase } from './run-explore.use-case.ts'
import type { ExploreWayIn } from './run-explore.use-case.ts'
import { fullCatalogue, provideMemoryExploreStore } from './test-fixtures.ts'
import { viewExploreUseCase } from './view-explore.use-case.ts'

vi.mock(import('../repositories/explore.repository.ts'))
vi.mock(import('../repositories/lists.repository.ts'))

const owner = { session: 'session-a', user: 'user-a' }

const typed =
  "db.applications.find(\n  { code: 'woodland' },\n  { clientRef: 1 }\n)"

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

const connectionError = () =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  )

const answer = (
  overrides: Partial<ExploreAnswer & WithVocabulary> = {}
): ExploreAnswer & WithVocabulary => ({
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
    }
  ],
  rows: [{ open: null, cells: { c0: 'wmp-aa1-bb2' } }],
  count: { n: 1, capped: false },
  groups: false,
  unwound: false,
  partial: false,
  unseen: [],
  window: null,
  vocabulary: null,
  ...overrides
})

const column = (key: string, label: string): ExploreColumn => ({
  key,
  label,
  kind: 'text',
  aggregate: false,
  path: null
})

/** The one row a lookup reads, keyed as GAS keys columns: by their place. */
const lookup = (business: string | null, sbi: string | null) =>
  answer({
    columns: [column('c0', 'business'), column('c1', 'sbi')],
    rows: [{ open: null, cells: { c0: business, c1: sbi } }]
  })

const run = (wayIn: ExploreWayIn) => runExploreUseCase({ owner, wayIn })

/** The text a way in held, read back as its run shows it. */
const heldText = async (wayIn: ExploreWayIn) => {
  const outcome = await run(wayIn)

  expect(outcome.kind).toBe('held')

  const shown = await viewExploreUseCase({
    owner,
    run: (outcome as { id: string }).id,
    page: 1
  })

  return (shown as { page: { q: string } }).page.q
}

const sent = () => vi.mocked(queryExplore).mock.calls.map(([body]) => body)

const none: ListLook = { facts: {}, window: {}, search: '' }

const entryWithId = (id: string) =>
  fullCatalogue.buckets.find((bucket) => bucket.id === id)

const listed = (from: string, look: Partial<ListLook> = {}): ExploreWayIn => ({
  kind: 'list',
  address: { path: from, params: {} },
  toList: (id) => {
    const bucket = entryWithId(id)

    return bucket ? { bucket, look: { ...none, ...look } } : null
  }
})

const vocabulary = {
  sources: [{ name: 'cases', label: 'Cases', time: null, paths: [] }]
}

const applicationRecord = '/dev-ops/applications/woodland/wmp-aa1-bb2'

beforeEach(() => {
  provideMemoryExploreStore()
  vi.mocked(checkExplore).mockResolvedValue({
    ok: true,
    source: 'applications',
    vocabulary: null
  })
  vi.mocked(queryExplore).mockResolvedValue(answer())
  vi.mocked(findVocabulary).mockResolvedValue({ sources: [] })
  vi.mocked(queryList).mockImplementation(async ({ path }) => ({
    shell: { catalogue: fullCatalogue },
    bucket:
      fullCatalogue.buckets.find((bucket) => bucket.path === path)?.id ?? '',
    list: null
  }))
})

describe('runExploreUseCase', () => {
  test('checks a typed query, then holds it, reading nothing yet', async () => {
    expect(await run({ kind: 'typed', q: typed })).toEqual({
      kind: 'held',
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      view: 'table'
    })
    expect(checkExplore).toHaveBeenCalledExactlyOnceWith(typed)
    expect(queryExplore).not.toHaveBeenCalled()
    expect(await recentQueries(owner)).toEqual([
      { id: expect.any(String), q: typed }
    ])
  })

  test.each([
    ['typed', { kind: 'typed' as const, q: typed, view: 'documents' as const }],
    [
      'picked',
      {
        kind: 'pick' as const,
        pick: 'applications',
        view: 'documents' as const
      }
    ]
  ])('lands a %s run in the view the editor was in', async (_, wayIn) => {
    expect(await run(wayIn)).toMatchObject({ kind: 'held', view: 'documents' })
  })

  test('keeps the editor’s view on a query it says is too long', async () => {
    const outcome = await run({
      kind: 'typed',
      q: 'x'.repeat(5000),
      view: 'documents'
    })

    expect(outcome).toMatchObject({ kind: 'page', page: { view: 'documents' } })
  })

  test('holds the typed query its run reads', async () => {
    expect(await heldText({ kind: 'typed', q: typed })).toBe(typed)
    expect(sent()).toEqual([{ query: typed }])
  })

  test('turns CRLF line breaks into LF, so GAS’s places line up with the editor’s text', async () => {
    expect(
      await heldText({ kind: 'typed', q: typed.replaceAll('\n', '\r\n') })
    ).toBe(typed)
    expect(checkExplore).toHaveBeenCalledExactlyOnceWith(typed)
  })

  test('says a query GAS refuses at the field, and holds nothing', async () => {
    const error = {
      message: 'applications has no field colour',
      at: 25,
      end: 31
    }

    vi.mocked(checkExplore).mockRejectedValue(
      responseError(400, { reason: 'QUERY_INVALID', error, vocabulary })
    )

    expect(await run({ kind: 'typed', q: typed })).toMatchObject({
      kind: 'page',
      page: {
        q: typed,
        run: null,
        result: { outcome: 'failed', failure: { kind: 'invalid', error } },
        recent: [],
        vocabulary
      }
    })
    expect(queryExplore).not.toHaveBeenCalled()
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('says a query over 4,000 characters where it goes over, asking GAS nothing', async () => {
    const q = `db.applications.find({ business: '${'x'.repeat(4000)}' })`

    expect(await run({ kind: 'typed', q })).toMatchObject({
      kind: 'page',
      page: {
        q,
        result: {
          outcome: 'failed',
          failure: {
            kind: 'invalid',
            error: {
              message: 'Shorten the query to 4,000 characters or fewer.',
              at: 4000,
              end: q.length
            }
          }
        }
      }
    })
    expect(checkExplore).not.toHaveBeenCalled()
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
    expect(await recentQueries(owner)).toEqual([])
  })

  test('holds a typed query GAS couldn’t check, so its run says what is wrong', async () => {
    vi.mocked(checkExplore).mockRejectedValue(connectionError())

    expect(await run({ kind: 'typed', q: typed })).toMatchObject({
      kind: 'held'
    })
  })

  test('runs an example without checking it, its dates as of today in UTC', async () => {
    vi.useFakeTimers({
      now: new Date('2026-11-14T23:30:00Z'),
      toFake: ['Date']
    })

    try {
      expect(
        await heldText({ kind: 'pick', pick: 'frps-cases-by-status' })
      ).toBe(
        "db.cases.aggregate([\n  { $match: { workflowCode: 'frps-private-beta', createdAt: { $gte: ISODate('2026-11-14') } } },\n  { $group: { _id: '$currentStatus', cases: { $sum: 1 } } }\n])"
      )
    } finally {
      vi.useRealTimers()
    }

    expect(checkExplore).not.toHaveBeenCalled()
  })

  test('runs a Recent query again by its id, as a new run', async () => {
    const first = await run({ kind: 'typed', q: typed })
    const [{ id }] = await recentQueries(owner)
    const again = await run({ kind: 'pick', pick: id })

    expect(again).toMatchObject({ kind: 'held' })
    expect(again).not.toEqual(first)
    expect(await heldText({ kind: 'pick', pick: id })).toBe(typed)
  })

  test('says a pick that is neither an example nor a Recent query has expired', async () => {
    expect(await run({ kind: 'pick', pick: 'everything' })).toMatchObject({
      kind: 'page',
      page: { q: '', notice: { kind: 'expired' } }
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('lists Recent newest first, distinct, the same text keeping its id', async () => {
    await run({ kind: 'typed', q: typed })

    const [before] = await recentQueries(owner)

    await run({ kind: 'typed', q: 'db.cases.find()' })
    await run({ kind: 'typed', q: typed })

    expect(await recentQueries(owner)).toEqual([
      before,
      { id: expect.any(String), q: 'db.cases.find()' }
    ])
  })

  test('keeps the last six Recent queries', async () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await run({ kind: 'typed', q: `db.applications.find().limit(${n})` })
    }

    expect((await recentQueries(owner)).map(({ q }) => q)).toEqual(
      [7, 6, 5, 4, 3, 2].map((n) => `db.applications.find().limit(${n})`)
    )
  })

  test('answers Keep looking without script with the run’s window to show at its address, reading nothing', async () => {
    const held = await run({ kind: 'typed', q: typed })
    const id = (held as { id: string }).id
    vi.mocked(queryExplore).mockClear()

    expect(
      await run({
        kind: 'window',
        run: id,
        page: 3,
        inPlace: false,
        view: 'documents'
      })
    ).toEqual({
      kind: 'held',
      id,
      page: 3,
      view: 'documents'
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('answers Keep looking in place with the window itself, read from where the last stopped', async () => {
    vi.mocked(queryExplore).mockResolvedValueOnce(
      answer({
        read: 'windowed',
        count: null,
        window: {
          to: '2026-10-01T00:00:00.000Z',
          end: false,
          positions: 'p1',
          skipped: []
        }
      })
    )
    const held = await run({ kind: 'typed', q: typed })
    const id = (held as { id: string }).id
    await viewExploreUseCase({ owner, run: id, page: 1 })
    vi.mocked(queryExplore).mockClear()

    expect(
      await run({
        kind: 'window',
        run: id,
        page: 2,
        inPlace: true,
        view: 'table'
      })
    ).toMatchObject({ kind: 'page', page: { run: { id, page: 2 } } })
    expect(queryExplore).toHaveBeenCalledExactlyOnceWith({
      query: typed,
      positions: 'p1'
    })
  })

  test.each([
    ['never held', '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'],
    ['not a run’s id', 'not-a-run']
  ])(
    'answers Keep looking in place on a run %s as gone, reading nothing',
    async (_, id) => {
      vi.mocked(queryExplore).mockClear()

      expect(
        await run({
          kind: 'window',
          run: id,
          page: 2,
          inPlace: true,
          view: 'documents'
        })
      ).toEqual({ kind: 'gone', id, view: 'documents' })
      expect(queryExplore).not.toHaveBeenCalled()
    }
  )

  test('opens Applications with its grant, its time range and its search', async () => {
    expect(
      await heldText(
        listed('applications', {
          facts: { code: 'example-grant' },
          window: {
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z'
          },
          search: 'ref:wmp-aa1-bb2'
        })
      )
    ).toBe(
      "db.applications.find(\n  { code: 'example-grant', createdAt: { $gte: ISODate('2026-10-01T00:00:00.000Z'), $lte: ISODate('2026-10-31T23:59:59.999Z') }, refs: 'ref:wmp-aa1-bb2' },\n  { clientRef: 1, code: 1, currentStatus: 1, createdAt: 1 }\n).sort({ createdAt: -1 })"
    )
    expect(checkExplore).not.toHaveBeenCalled()
  })

  test('opens a list with nothing on as an empty filter', async () => {
    expect(await heldText(listed('applications'))).toBe(
      'db.applications.find(\n  {},\n  { clientRef: 1, code: 1, currentStatus: 1, createdAt: 1 }\n).sort({ createdAt: -1 })'
    )
  })

  test('opens a quick range from the instant it was given', async () => {
    expect(
      await heldText(
        listed('cases', { window: { from: '2026-11-13T12:00:00.000Z' } })
      )
    ).toContain("createdAt: { $gte: ISODate('2026-11-13T12:00:00.000Z') }")
  })

  test.each([
    [
      'cases',
      { workflowCode: 'example-grant', currentConfigVersion: '1.0.0' },
      "db.cases.find(\n  { workflowCode: 'example-grant', currentConfigVersion: '1.0.0' },\n  { caseRef: 1, workflowCode: 1, currentStatus: 1, createdAt: 1 }\n).sort({ createdAt: -1 })"
    ],
    [
      'grants',
      { grantCode: 'woodland', worstFetchStatus: ['fetched', 'pending'] },
      "db.grants.find(\n  { grantCode: 'woodland', worstFetchStatus: { $in: ['fetched', 'pending'] } },\n  { grantCode: 1, version: 1, status: 1, worstFetchStatus: 1, receivedAt: 1 }\n).sort({ receivedAt: -1 })"
    ],
    [
      'workflows',
      { grantCode: 'woodland-creation' },
      "db.workflows.find(\n  { grantCode: 'woodland-creation' },\n  { grantCode: 1, version: 1, status: 1, fetchStatus: 1, receivedAt: 1 }\n).sort({ receivedAt: -1 })"
    ]
  ])('opens %s with its filters, as stored', async (from, facts, query) => {
    expect(await heldText(listed(from, { facts }))).toBe(query)
  })

  test.each([
    ['events/gas', 'GAS', ['outbox'], ", box: 'outbox'"],
    ['events/cw', 'CW', ['inbox'], ", box: 'inbox'"],
    ['events/gas', 'GAS', [], ''],
    ['events/cw', 'CW', ['outbox', 'inbox'], '']
  ])(
    'opens %s with its service, and its box when %j is the one queue picked',
    async (from, service, queues, box) => {
      expect(
        await heldText(
          listed(from, {
            facts: { box: queues, eventType: 'CreateCase' },
            search: 'id:66f000000000000000000001'
          })
        )
      ).toBe(
        `db.events.find(\n  { service: '${service}'${box}, eventType: 'CreateCase', refs: 'id:66f000000000000000000001' },\n  { publicationDate: 1, eventType: 1, status: 1, 'event.id': 1, 'lastError.message': 1 }\n).sort({ publicationDate: -1 })`
      )
    }
  )

  test('opens an Event picked outside the queue picked as the list reads it: that queue, that event', async () => {
    expect(
      await heldText(
        listed('events/gas', {
          facts: { box: ['inbox'], eventType: ['Audit'] }
        })
      )
    ).toContain("{ service: 'GAS', box: 'inbox', eventType: 'Audit' }")
  })

  test('asks GAS only where the list is, then reads what it shows from the list GAS named', async () => {
    const address = {
      path: 'cases',
      params: { grant: 'example-grant' },
      from: '2026-10-01T00:00:00.000Z'
    }
    const cases = fullCatalogue.buckets.find(({ path }) => path === 'cases')!
    const toList = vi.fn(() => ({ bucket: cases, look: none }))

    expect(await run({ kind: 'list', address, toList })).toMatchObject({
      kind: 'held'
    })
    expect(queryList).toHaveBeenCalledExactlyOnceWith({
      ...address,
      search: null,
      read: false
    })
    expect(toList).toHaveBeenCalledExactlyOnceWith(cases.id)
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test.each([
    ['a list there is no such', 'nowhere'],
    ['a list Explore doesn’t open', 'other']
  ])('refuses %s as not found', async (_, from) => {
    vi.mocked(queryList).mockResolvedValueOnce({
      shell: { catalogue: fullCatalogue },
      bucket: from === 'other' ? 'gas.other' : 'gas.nowhere',
      list: null
    })

    await expect(
      run({
        kind: 'list',
        address: { path: from, params: {} },
        toList: (id) =>
          id === 'gas.other'
            ? {
                bucket: { ...fullCatalogue.buckets[2], id: 'gas.other' },
                look: none
              }
            : null
      })
    ).rejects.toMatchObject({ output: { statusCode: 404 } })
    expect(await recentQueries(owner)).toEqual([])
  })

  test.each([
    [
      'no list at the path',
      responseError(404, { code: 'LIST_NOT_FOUND' }),
      404
    ],
    [
      'an address the list can’t have',
      responseError(400, { code: 'ADDRESS_REFUSED', bucket: 'cases' }),
      400
    ],
    [
      'a range that can’t be one',
      responseError(400, { code: 'RANGE_REFUSED', bucket: 'cases' }),
      400
    ],
    [
      'Caseworking unreachable for its list',
      responseError(503, { code: 'CW_UNREACHABLE' }),
      503
    ],
    [
      'no catalogue GAS could build',
      responseError(503, { code: 'CATALOGUE_UNAVAILABLE' }),
      503
    ],
    ['no answer', Boom.gatewayTimeout('Client request timeout'), 503]
  ])(
    'refuses a list with %s, holding nothing',
    async (_, error, statusCode) => {
      vi.mocked(queryList).mockRejectedValueOnce(error)

      await expect(run(listed('cases'))).rejects.toMatchObject({
        output: { statusCode }
      })
      expect(await recentQueries(owner)).toEqual([])
    }
  )

  test.each([
    [
      'applications-by-business',
      "db.applications.find(\n  { 'phases.answers.applicant.business.name': 'Hilltop Farm' },\n  { clientRef: 1, code: 1, currentConfigVersion: 1, currentStatus: 1, createdAt: 1 }\n).sort({ createdAt: -1 })"
    ],
    [
      'cases-by-sbi',
      "db.cases.aggregate([\n  { $match: { refs: 'sbi:200000002' } },\n  { $group: { _id: '$currentStage', cases: { $sum: 1 }, latest: { $max: '$createdAt' } } },\n  { $sort: { cases: -1 } }\n])"
    ],
    [
      'payments-by-sbi',
      "db.payments.find(\n  { sbi: '200000002' },\n  { invoiceNumber: 1, 'source.agreementNumber': 1, 'agreement.code': 1, 'payments.status': 1, totalAmountPence: 1, 'payments.dueDate': 1 }\n).sort({ 'payments.dueDate': -1 })"
    ]
  ])(
    'finds others %s: reads the application’s business name and SBI through Explore, then holds its query',
    async (find, query) => {
      vi.mocked(queryExplore).mockResolvedValueOnce(
        lookup('Hilltop Farm', '200000002')
      )

      expect(
        await heldText({ kind: 'find', find, record: applicationRecord })
      ).toBe(query)
      expect(queryExplore).toHaveBeenNthCalledWith(1, {
        query:
          "db.applications.find(\n  { code: 'woodland', clientRef: 'wmp-aa1-bb2' },\n  { business: '$phases.answers.applicant.business.name', sbi: '$identifiers.sbi' }\n).limit(1)"
      })
    }
  )

  test('finds others by the column the lookup put the value in, whatever GAS labels it', async () => {
    vi.mocked(queryExplore).mockResolvedValueOnce(
      answer({
        columns: [column('c0', 'SBI'), column('c1', 'Business name')],
        rows: [{ open: null, cells: { c0: 'Hilltop Farm', c1: '200000002' } }]
      })
    )

    expect(
      await heldText({
        kind: 'find',
        find: 'payments-by-sbi',
        record: applicationRecord
      })
    ).toContain("{ sbi: '200000002' }")
  })

  test('quotes a value with a quote in it', async () => {
    vi.mocked(queryExplore).mockResolvedValueOnce(
      lookup("O'Brien \\ Sons", null)
    )

    expect(
      await heldText({
        kind: 'find',
        find: 'applications-by-business',
        record: applicationRecord
      })
    ).toContain(
      "{ 'phases.answers.applicant.business.name': 'O\\'Brien \\\\ Sons' }"
    )
  })

  test('reads a case through its workflow', async () => {
    vi.mocked(queryExplore).mockResolvedValueOnce(
      lookup('Hilltop Farm', '200000002')
    )

    await run({
      kind: 'find',
      find: 'cases-by-sbi',
      record: '/dev-ops/cases/frps-private-beta/CASE-1'
    })

    expect(sent()[0].query).toBe(
      "db.cases.find(\n  { workflowCode: 'frps-private-beta', caseRef: 'CASE-1' },\n  { business: '$payload.answers.applicant.business.name', sbi: '$payload.identifiers.sbi' }\n).limit(1)"
    )
  })

  test.each([
    [
      'an application with no business name',
      'applications-by-business',
      applicationRecord,
      lookup(null, '200000002'),
      { kind: 'no-value', noun: 'application', by: 'business' }
    ],
    [
      'a case with no SBI',
      'cases-by-sbi',
      '/dev-ops/cases/frps-private-beta/CASE-1',
      lookup('Hilltop Farm', null),
      { kind: 'no-value', noun: 'case', by: 'sbi' }
    ],
    [
      'a record the lookup didn’t find',
      'payments-by-sbi',
      applicationRecord,
      answer({ columns: lookup(null, null).columns, rows: [] }),
      { kind: 'no-value', noun: 'application', by: 'sbi' }
    ]
  ])(
    'says %s has no value to find by, and holds nothing',
    async (_, find, record, read, notice) => {
      vi.mocked(queryExplore).mockResolvedValueOnce({ ...read, vocabulary })

      expect(await run({ kind: 'find', find, record })).toMatchObject({
        kind: 'page',
        page: { q: 'db.applications.find()', run: null, notice, vocabulary }
      })
      expect(sent()).toHaveLength(1)
      expect(findVocabulary).not.toHaveBeenCalled()
      expect(await recentQueries(owner)).toEqual([])
    }
  )

  test('says why when the record couldn’t be read, with the vocabulary GAS’s refusal carried', async () => {
    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(400, { reason: 'QUERY_REFUSED', message: 'No', vocabulary })
    )

    expect(
      await run({
        kind: 'find',
        find: 'cases-by-sbi',
        record: '/dev-ops/cases/frps-private-beta/CASE-1'
      })
    ).toMatchObject({
      page: {
        result: { outcome: 'failed', failure: { kind: 'refused' } },
        vocabulary
      }
    })
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('says why when the record couldn’t be read at all', async () => {
    vi.mocked(queryExplore).mockRejectedValueOnce(connectionError())

    expect(
      await run({
        kind: 'find',
        find: 'cases-by-sbi',
        record: '/dev-ops/cases/frps-private-beta/CASE-1'
      })
    ).toMatchObject({
      kind: 'page',
      page: {
        q: 'db.applications.find()',
        result: {
          outcome: 'failed',
          failure: {
            kind: 'no-answer',
            service: 'GAS',
            failure: { kind: 'not-connected' }
          }
        }
      }
    })
  })

  test.each([
    ['an item it doesn’t have', 'everything', applicationRecord],
    [
      'a page that isn’t a record',
      'cases-by-sbi',
      '/dev-ops/grants/woodland/1.0.0'
    ]
  ])('refuses %s as a bad request', async (_, find, record) => {
    await expect(run({ kind: 'find', find, record })).rejects.toMatchObject({
      output: { statusCode: 400 }
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })
})

const idOf = (value: unknown): string =>
  Buffer.from(BSON.serialize({ _id: value })).toString('base64')

const hex = '6741a0c2e4b0f1a2b3c4d5e6'

describe('Show it', () => {
  const show = (
    id = idOf(new ObjectId(hex)),
    at: (number | null)[] = [2, null]
  ) => ({
    id,
    at,
    service: 'CW' as const,
    box: 'inbox' as const
  })

  const heldRun = async (q = typed) =>
    ((await run({ kind: 'typed', q })) as { id: string }).id

  const shown = async (source: string, row = show(), result = 3) =>
    (await run({ kind: 'show', run: source, show: row, result })) as {
      kind: string
      id: string
      view: string
    }

  test('holds the row under its run, asking GAS nothing, to show in Documents', async () => {
    const source = await heldRun()
    vi.mocked(queryExplore).mockClear()
    vi.mocked(checkExplore).mockClear()

    const outcome = await shown(source)

    expect(outcome).toEqual({
      kind: 'held',
      id: expect.any(String),
      view: 'documents'
    })
    expect(outcome.id).not.toBe(source)
    expect(queryExplore).not.toHaveBeenCalled()
    expect(checkExplore).not.toHaveBeenCalled()
  })

  test('reads the run’s own query, unchanged, beside the row it shows, numbered as the run numbered it', async () => {
    const source = await heldRun()
    const { id } = await shown(source)
    vi.mocked(queryExplore).mockClear()

    const page = await viewExploreUseCase({
      owner,
      run: id,
      page: 1,
      view: 'documents'
    })

    expect(queryExplore).toHaveBeenCalledExactlyOnceWith({
      query: typed,
      show: show(),
      documents: true
    })
    expect(page).toMatchObject({
      kind: 'page',
      page: { q: typed, run: { id, shown: 3 } }
    })
  })

  test('gives each row of a run an address of its own, the same row the same one', async () => {
    const source = await heldRun()
    const first = await shown(source)
    const again = await shown(source)
    const other = await shown(source, show(idOf(new ObjectId(hex)), [5, null]))

    expect(again.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
  })

  test('holds one Show it a run, the newest replacing the last, whose address then reads as expired', async () => {
    const source = await heldRun()
    const first = await shown(source)
    const second = await shown(source, show(idOf('WMP-2')))

    expect(await findLiveRun(owner, first.id)).toBeNull()
    expect(await findLiveRun(owner, second.id)).toMatchObject({
      show: show(idOf('WMP-2'))
    })
    expect(
      await viewExploreUseCase({ owner, run: first.id, page: 1 })
    ).toMatchObject({ kind: 'page', page: { notice: { kind: 'expired' } } })
  })

  test('is never in Recent nor counted among the runs held, and goes with its run', async () => {
    const source = await heldRun()
    const { id } = await shown(source)

    expect((await recentQueries(owner)).map(({ q }) => q)).toEqual([typed])

    for (let n = 1; n <= 9; n += 1) {
      await heldRun(`db.applications.find().limit(${n})`)
    }

    expect(await findLiveRun(owner, source)).not.toBeNull()
    expect(await findLiveRun(owner, id)).not.toBeNull()

    await heldRun('db.applications.find().limit(10)')

    expect(await findLiveRun(owner, source)).toBeNull()
    expect(await findLiveRun(owner, id)).toBeNull()
  })

  test('keeps the source run held however many of its rows Show it opens', async () => {
    const source = await heldRun()

    for (let n = 0; n < 12; n += 1) {
      await shown(source, show(idOf(`WMP-${n}`)))
    }

    expect(await findLiveRun(owner, source)).not.toBeNull()
  })

  test.each([
    ['not BSON', 'AAAA'],
    [
      'a document with another key',
      Buffer.from(BSON.serialize({ id: 1 })).toString('base64')
    ],
    [
      'a document of two keys',
      Buffer.from(BSON.serialize({ _id: 1, a: 2 })).toString('base64')
    ]
  ])('refuses a row id that is %s', async (_, id) => {
    const source = await heldRun()

    await expect(shown(source, show(id))).rejects.toMatchObject({
      output: { statusCode: 400 }
    })
  })

  test('says a run another person holds, or one let go, has expired', async () => {
    const source = await heldRun()

    expect(
      await runExploreUseCase({
        owner: { session: 'session-b', user: 'user-b' },
        wayIn: { kind: 'show', run: source, show: show(), result: 1 }
      })
    ).toMatchObject({ kind: 'page', page: { notice: { kind: 'expired' } } })
  })
})

describe('an open in place', () => {
  const show = {
    id: idOf(new ObjectId(hex)),
    at: [],
    service: null,
    box: null
  }

  const heldRun = async () =>
    ((await run({ kind: 'typed', q: typed })) as { id: string }).id

  const open = (source: string, row = show) =>
    run({ kind: 'open', run: source, show: row, result: 3 })

  test('reads the row now, in one call of the run’s query beside it, its document whole', async () => {
    const source = await heldRun()
    vi.mocked(queryExplore).mockClear()
    vi.mocked(checkExplore).mockClear()

    expect(await open(source)).toEqual({
      kind: 'opened',
      run: source,
      show,
      result: 3,
      read: {
        outcome: 'read',
        answer: expect.objectContaining({ rows: answer().rows })
      }
    })
    expect(queryExplore).toHaveBeenCalledExactlyOnceWith({
      query: typed,
      show,
      documents: true
    })
    expect(checkExplore).not.toHaveBeenCalled()
  })

  test('writes nothing: no run held, nothing in Recent, the run’s Show it slot as it was', async () => {
    const store = provideMemoryExploreStore()
    const source = await heldRun()
    const kept = structuredClone(new Map(store))

    await open(source)

    expect(new Map(store)).toEqual(kept)
  })

  test('says how GAS failed, reading nothing more', async () => {
    const source = await heldRun()
    vi.mocked(queryExplore).mockClear()
    vi.mocked(queryExplore).mockRejectedValueOnce(
      responseError(429, { reason: 'QUERY_BUSY' })
    )

    expect(await open(source)).toMatchObject({
      kind: 'opened',
      read: { outcome: 'failed', failure: { kind: 'busy' } }
    })
    expect(queryExplore).toHaveBeenCalledTimes(1)
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('says a run no longer held, asking GAS nothing', async () => {
    vi.mocked(queryExplore).mockClear()

    expect(await open('0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b')).toMatchObject({
      kind: 'opened',
      read: null
    })
    expect(queryExplore).not.toHaveBeenCalled()
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('refuses a row id that isn’t a record’s { _id }', async () => {
    const source = await heldRun()

    await expect(open(source, { ...show, id: 'AAAA' })).rejects.toMatchObject({
      output: { statusCode: 400 }
    })
  })
})
