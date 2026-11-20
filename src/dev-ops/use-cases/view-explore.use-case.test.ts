import Boom from '@hapi/boom'

import type {
  ExploreAnswer,
  Vocabulary,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  findVocabulary,
  queryExplore
} from '../repositories/explore.repository.ts'
import { findLiveRun, holdRun, keepPage } from './held-runs.ts'
import { provideMemoryExploreStore } from './test-fixtures.ts'
import {
  restoreExploreUseCase,
  viewExploreUseCase,
  viewWindowUseCase
} from './view-explore.use-case.ts'

vi.mock(import('../repositories/explore.repository.ts'))

const owner = { session: 'session-a', user: 'user-a' }

const typed = "db.applications.find({ code: 'woodland' })"

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

/** An answer as the page holds it: the vocabulary it carried goes beside it. */
const shown = ({
  vocabulary: _vocabulary,
  ...held
}: ExploreAnswer & WithVocabulary): ExploreAnswer => held

const windowed = (positions: string | null, end = false, rows = 1) =>
  answer({
    read: 'windowed',
    count: null,
    rows: Array.from({ length: rows }, () => answer().rows[0]),
    window: { to: '2026-10-01T00:00:00.000Z', end, positions, skipped: [] }
  })

const vocabulary: Vocabulary = {
  sources: [
    { name: 'applications', label: 'Applications', time: null, paths: [] },
    { name: 'ledgers', label: 'Ledgers', time: null, paths: [] }
  ]
}

const sent = () => vi.mocked(queryExplore).mock.calls.map(([body]) => body)

const view = (run: string | null, page = 1, as = owner) =>
  viewExploreUseCase({ owner: as, run, page })

beforeEach(() => {
  provideMemoryExploreStore()
  vi.mocked(queryExplore).mockResolvedValue(answer())
  vi.mocked(findVocabulary).mockResolvedValue(vocabulary)
})

describe('viewExploreUseCase', () => {
  test('opens on the default query, unrun, with Recent and exactly the sources GAS lists for this person', async () => {
    await holdRun(owner, typed)

    expect(await view(null)).toEqual({
      kind: 'page',
      page: {
        q: 'db.applications.find()',
        run: null,
        result: null,
        previous: null,
        notice: null,
        recent: [{ id: expect.any(String), q: typed }],
        vocabulary
      }
    })
    expect(queryExplore).not.toHaveBeenCalled()
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
  })

  test('carries no vocabulary when GAS can’t give it', async () => {
    vi.mocked(findVocabulary).mockRejectedValue(Boom.badGateway())

    expect(await view(null)).toMatchObject({
      kind: 'page',
      page: { vocabulary: null }
    })
  })

  test('runs a held run’s first window, the text back in the editor', async () => {
    vi.mocked(queryExplore).mockResolvedValue({ ...answer(), vocabulary })

    const id = await holdRun(owner, typed)

    expect(await view(id)).toEqual({
      kind: 'page',
      page: {
        q: typed,
        run: { id, page: 1 },
        result: { outcome: 'read', answer: shown(answer()) },
        previous: null,
        notice: null,
        recent: [{ id: expect.any(String), q: typed }],
        vocabulary
      }
    })
    expect(queryExplore).toHaveBeenCalledExactlyOnceWith({ query: typed })
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('draws a window GAS refused with the vocabulary its refusal carried', async () => {
    vi.mocked(queryExplore).mockRejectedValue(
      new Boom.Boom('Response Error: 400', {
        statusCode: 400,
        data: {
          isResponseError: true,
          payload: { reason: 'QUERY_REFUSED', message: 'Too big', vocabulary }
        }
      })
    )

    const id = await holdRun(owner, typed)

    expect(await view(id)).toMatchObject({
      page: { result: { outcome: 'failed' }, vocabulary }
    })
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('draws a window GAS didn’t answer with no vocabulary, asking nothing more', async () => {
    vi.mocked(queryExplore).mockRejectedValue(Boom.gatewayTimeout())

    const id = await holdRun(owner, typed)

    expect(await view(id)).toMatchObject({
      page: { result: { outcome: 'failed' }, vocabulary: null }
    })
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('reads the next window from where the last stopped, counting what the run has found', async () => {
    vi.mocked(queryExplore)
      .mockResolvedValueOnce(windowed('after-first'))
      .mockResolvedValueOnce(windowed(null, true, 2))

    const id = await holdRun(owner, typed)

    await view(id)

    const next = await view(id, 2)

    expect(sent()).toEqual([
      { query: typed },
      { query: typed, positions: 'after-first' }
    ])
    expect(next).toMatchObject({
      kind: 'page',
      page: {
        run: { id, page: 2 },
        previous: {
          positions: 'after-first',
          end: false,
          found: 1,
          source: { name: 'applications', noun: 'application' }
        }
      }
    })
  })

  test('counts what every window before has found', async () => {
    vi.mocked(queryExplore)
      .mockResolvedValueOnce(windowed('after-first', false, 2))
      .mockResolvedValueOnce(windowed('after-second', false, 3))
      .mockResolvedValueOnce(windowed(null, true))

    const id = await holdRun(owner, typed)

    await view(id)
    await view(id, 2)

    expect(await view(id, 3)).toMatchObject({
      page: { previous: { positions: 'after-second', found: 5 } }
    })
    expect(sent()[2]).toEqual({ query: typed, positions: 'after-second' })
  })

  test.each([
    ['one it hasn’t reached', 3, async () => undefined],
    [
      'one after the end',
      2,
      async (id: string) =>
        keepPage(owner, id, 1, {
          positions: null,
          end: true,
          found: 1,
          source: { name: 'applications', noun: 'application' }
        })
    ]
  ])(
    'goes back to the first window for %s, reading nothing',
    async (_, page, before) => {
      const id = await holdRun(owner, typed)

      await before(id)

      expect(await view(id, page)).toEqual({ kind: 'restart', id })
      expect(queryExplore).not.toHaveBeenCalled()
    }
  )

  test('keeps no window GAS couldn’t read, so the next can’t start from it', async () => {
    vi.mocked(queryExplore).mockRejectedValueOnce(Boom.badGateway())

    const id = await holdRun(owner, typed)
    const failed = await view(id)

    expect(failed).toMatchObject({
      kind: 'page',
      page: { result: { outcome: 'failed' } }
    })
    expect(await view(id, 2)).toEqual({ kind: 'restart', id })
  })

  test('says a run never held has expired, with the editor empty, reading nothing', async () => {
    expect(await view('0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b')).toMatchObject({
      kind: 'page',
      page: { q: '', run: null, result: null, notice: { kind: 'expired' } }
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('says an id that isn’t a run’s has expired, reading nothing', async () => {
    expect(await view('not-a-uuid')).toMatchObject({
      kind: 'page',
      page: { q: '', run: null, notice: { kind: 'expired' } }
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test.each([
    ['another session', { session: 'session-b', user: 'user-a' }],
    [
      'another user on the same session',
      { session: 'session-a', user: 'user-b' }
    ]
  ])('holds a run as expired for %s', async (_, other) => {
    const id = await holdRun(owner, typed)

    expect(await view(id, 1, other)).toMatchObject({
      page: { notice: { kind: 'expired' } }
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('holds the last ten runs, so an eleventh lets the first go', async () => {
    const first = await holdRun(owner, typed)

    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      await holdRun(owner, `db.cases.find().limit(${n})`)
    }

    expect(await view(first)).toMatchObject({ page: { notice: null } })

    await holdRun(owner, 'db.cases.find().limit(11)')

    expect(await view(first)).toMatchObject({
      page: { notice: { kind: 'expired' } }
    })
  })

  test('says a run held more than 30 minutes has expired', async () => {
    const id = await holdRun(owner, typed)

    vi.useFakeTimers({ now: Date.now() + 31 * 60 * 1000, toFake: ['Date'] })

    try {
      expect(await view(id)).toMatchObject({
        page: { notice: { kind: 'expired' } }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('a slow window in one tab undoes nothing held in another meanwhile', async () => {
    let release: (value: ExploreAnswer & WithVocabulary) => void = () =>
      undefined

    vi.mocked(queryExplore).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const first = await holdRun(owner, typed)
    const reading = view(first)
    const other = await holdRun(owner, 'db.cases.find()')

    release(windowed('after-first'))
    await reading

    expect(await view(other)).toMatchObject({
      page: { q: 'db.cases.find()', notice: null }
    })
    expect(await view(first, 2)).toMatchObject({
      page: { run: { id: first, page: 2 } }
    })
  })
})

describe('viewWindowUseCase', () => {
  test('reads the next window of a held run from where the last stopped', async () => {
    vi.mocked(queryExplore).mockResolvedValueOnce(windowed('after-first'))

    const id = await holdRun(owner, typed)

    await view(id)

    expect(
      await viewWindowUseCase({ owner }, { run: id, page: 2 })
    ).toMatchObject({ kind: 'page', page: { run: { id, page: 2 } } })
    expect(sent()[1]).toEqual({ query: typed, positions: 'after-first' })
  })

  test('says a run no longer held is gone, reading nothing', async () => {
    const id = '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'

    expect(await viewWindowUseCase({ owner }, { run: id, page: 2 })).toEqual({
      kind: 'gone',
      id
    })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('goes back to the first window for one it can’t start', async () => {
    const id = await holdRun(owner, typed)

    expect(await viewWindowUseCase({ owner }, { run: id, page: 3 })).toEqual({
      kind: 'restart',
      id
    })
  })
})

describe('restoreExploreUseCase', () => {
  const rowOf = (ref: string) => ({ open: null, cells: { c0: ref } })

  const windowOf = (positions: string | null, refs: string[], end = false) =>
    answer({
      read: 'windowed',
      count: null,
      rows: refs.map(rowOf),
      window: { to: '2026-10-01T00:00:00.000Z', end, positions, skipped: [] }
    })

  const restore = (run: string, through: number) =>
    restoreExploreUseCase({ owner, run, through })

  /** A run read by Keep looking through window `n`, each window a ref of its own. */
  const readThrough = async (n: number) => {
    const id = await holdRun(owner, typed)

    for (const page of Array.from({ length: n }, (_, i) => i + 1)) {
      vi.mocked(queryExplore).mockResolvedValueOnce(
        windowOf(`after-${page}`, [`ref-${page}`])
      )
      await view(id, page)
    }

    vi.mocked(queryExplore).mockClear()

    return id
  }

  const joined = (
    windows: ExploreAnswer[],
    stopped: { statusCode: number; code: string } | null = null
  ) => ({
    ...windows.at(-1)!,
    rows: windows.flatMap(({ rows }) => rows),
    windowRows: windows.map(({ rows }) => rows.length),
    stopped,
    vocabulary
  })

  test('reads every window through the one named again in one call, as one page of every row', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([
        windowOf('after-1', ['ref-1']),
        windowOf('after-2', ['ref-2', 'ref-2b']),
        windowOf('after-3', ['ref-3'])
      ])
    )

    expect(await restore(id, 3)).toEqual({
      kind: 'page',
      page: {
        q: typed,
        run: { id, page: 3, through: 3, windowRows: [1, 2, 1], stopped: null },
        result: {
          outcome: 'read',
          answer: shown(
            windowOf('after-3', ['ref-1', 'ref-2', 'ref-2b', 'ref-3'], false)
          )
        },
        previous: null,
        notice: null,
        recent: [{ id: expect.any(String), q: typed }],
        vocabulary
      }
    })
    expect(vi.mocked(queryExplore).mock.calls).toEqual([
      [{ query: typed, windows: 3 }]
    ])
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('keeps where the last window read stopped, so Keep looking goes on from it', async () => {
    const id = await readThrough(2)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([windowOf('again-1', ['ref-1']), windowOf('again-2', ['ref-2'])])
    )
    await restore(id, 2)

    expect(await view(id, 3)).toMatchObject({
      page: { previous: { positions: 'again-2', found: 2 } }
    })
    expect(sent()[1]).toEqual({ query: typed, positions: 'again-2' })
  })

  test('stops at a window that reaches the end before the one named', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([windowOf('after-1', ['ref-1']), windowOf(null, ['ref-2'], true)])
    )

    expect(await restore(id, 3)).toMatchObject({
      page: {
        run: { id, page: 2, through: 3, windowRows: [1, 1], stopped: null },
        result: { answer: { rows: ['ref-1', 'ref-2'].map(rowOf) } }
      }
    })
  })

  test('keeps the rows before a later window that couldn’t be read, and says it stopped', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([windowOf('after-1', ['ref-1'])], {
        statusCode: 504,
        code: 'TIMED_OUT'
      })
    )

    const restored = await restore(id, 3)

    expect(restored).toMatchObject({
      page: {
        run: {
          id,
          page: 1,
          through: 3,
          windowRows: [1],
          stopped: { statusCode: 504, code: 'TIMED_OUT' }
        },
        result: { outcome: 'read', answer: { rows: [rowOf('ref-1')] } }
      }
    })
    expect(restored).not.toHaveProperty('page.result.answer.stopped')
  })

  test('sends a restore cut for too many cells to the window it asked for, on its own page, and learns the limit', async () => {
    const id = await readThrough(5)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined(
        [
          windowOf('again-1', ['ref-1']),
          windowOf('again-2', ['ref-2']),
          windowOf('again-3', ['ref-3'])
        ],
        { statusCode: 413, code: 'TOO_MANY_CELLS' }
      )
    )

    expect(await restore(id, 5)).toEqual({ kind: 'apart', id, page: 5 })
    expect(await findLiveRun(owner, id)).toMatchObject({ restorable: 3 })
    expect(await view(id, 5)).toMatchObject({
      page: {
        run: { id, page: 5, restorable: 3 },
        previous: { positions: 'after-4', found: 4 }
      }
    })
    expect(sent()[1]).toEqual({ query: typed, positions: 'after-4' })
  })

  test('keeps the last window read when the next wouldn’t fit in one answer, so the window after it goes on from it', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([windowOf('again-1', ['ref-1']), windowOf('again-2', ['ref-2'])], {
        statusCode: 413,
        code: 'TOO_MANY_CELLS'
      })
    )

    expect(await restore(id, 3)).toEqual({ kind: 'apart', id, page: 3 })
    expect(await view(id, 3)).toMatchObject({
      page: {
        run: { id, page: 3, restorable: 2 },
        previous: { positions: 'again-2', found: 2 }
      }
    })
    expect(sent()[1]).toEqual({ query: typed, positions: 'again-2' })
  })

  test('a run let go while its restore read stays gone when the restore learns its limit', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockImplementationOnce(async () => {
      for (const n of Array.from({ length: 10 }, (_, i) => i)) {
        await holdRun(owner, `db.cases.find({ n: ${n} })`)
      }

      return joined([windowOf('again-1', ['ref-1'])], {
        statusCode: 413,
        code: 'TOO_MANY_CELLS'
      })
    })

    await restore(id, 3)

    expect(await findLiveRun(owner, id)).toBeNull()
  })

  test('says the first window couldn’t be read, with the vocabulary its refusal carried, coming back to every window on Try again', async () => {
    const id = await readThrough(3)

    vi.mocked(queryExplore).mockRejectedValueOnce(
      new Boom.Boom('Response Error: 503', {
        statusCode: 503,
        data: { isResponseError: true, payload: { vocabulary } }
      })
    )

    expect(await restore(id, 3)).toMatchObject({
      page: {
        run: { id, page: 1, through: 3 },
        result: { outcome: 'failed' },
        previous: null,
        vocabulary
      }
    })
  })

  test.each([
    ['more than 50', 60, 50],
    ['exactly 50', 50, 50]
  ])('reads %s windows again as at most 50', async (_, through, windows) => {
    const id = await readThrough(through)

    vi.mocked(queryExplore).mockResolvedValueOnce(
      joined([windowOf('after-1', ['ref-1'])])
    )

    expect(await restore(id, through)).toMatchObject({
      page: { run: { through: windows } }
    })
    expect(sent()).toEqual([{ query: typed, windows }])
  })

  test('goes back to the first window for one not yet reached, reading nothing', async () => {
    const id = await readThrough(2)

    expect(await restore(id, 4)).toEqual({ kind: 'restart', id })
    expect(queryExplore).not.toHaveBeenCalled()
  })

  test('says a run no longer held has expired, reading only the vocabulary', async () => {
    expect(
      await restore('0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b', 2)
    ).toMatchObject({ page: { notice: { kind: 'expired' }, vocabulary } })
    expect(queryExplore).not.toHaveBeenCalled()
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
  })
})
