import Boom from '@hapi/boom'

import type {
  ExploreAnswer,
  WithVocabulary
} from '../repositories/explore.repository.ts'
import {
  findVocabulary,
  queryExplore
} from '../repositories/explore.repository.ts'
import { downloadExploreUseCase } from './download-explore.use-case.ts'
import { holdRun } from './held-runs.ts'
import { provideMemoryExploreStore } from './test-fixtures.ts'
import { viewExploreUseCase } from './view-explore.use-case.ts'

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

const windowed = (positions: string | null, end = false) =>
  answer({
    read: 'windowed',
    count: null,
    window: { to: '2026-10-01T00:00:00.000Z', end, positions, skipped: [] }
  })

const view = (run: string, page = 1) => viewExploreUseCase({ owner, run, page })

const download = (run: string) => downloadExploreUseCase({ owner, run })

const lastSent = () => vi.mocked(queryExplore).mock.calls.at(-1)

beforeEach(() => {
  provideMemoryExploreStore()
  vi.mocked(findVocabulary).mockResolvedValue({ sources: [] })
})

describe('downloadExploreUseCase', () => {
  test('reads an exact run in full, capped at 5,000', async () => {
    const file = answer({ partial: true })

    vi.mocked(queryExplore)
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(file)

    const id = await holdRun(owner, typed)

    await view(id)

    expect(await download(id)).toEqual({ kind: 'file', answer: shown(file) })
    expect(lastSent()).toEqual([{ query: typed, csv: true }])
  })

  test('reads a run no window of which was read from the top', async () => {
    vi.mocked(queryExplore).mockResolvedValue(answer())

    const id = await holdRun(owner, typed)

    await download(id)

    expect(lastSent()).toEqual([{ query: typed, csv: true }])
  })

  test('reads down to the furthest window Keep looking loaded', async () => {
    vi.mocked(queryExplore)
      .mockResolvedValueOnce(windowed('after-1'))
      .mockResolvedValueOnce(windowed('after-2'))
      .mockResolvedValueOnce(windowed('after-1'))
      .mockResolvedValueOnce(answer())

    const id = await holdRun(owner, typed)

    await view(id)
    await view(id, 2)
    await view(id)
    await download(id)

    expect(lastSent()?.[0]).toEqual({
      query: typed,
      positions: 'after-2',
      csv: true
    })
  })

  test('reads down to the furthest window any tab loaded, though a slower tab’s earlier window lands last', async () => {
    let release: (value: ExploreAnswer & WithVocabulary) => void = () =>
      undefined

    vi.mocked(queryExplore)
      .mockResolvedValueOnce(windowed('after-1'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      .mockResolvedValueOnce(windowed('after-2'))
      .mockResolvedValueOnce(windowed('after-3'))
      .mockResolvedValueOnce(answer())

    const id = await holdRun(owner, typed)

    await view(id)

    const slow = view(id, 2)

    await view(id, 2)
    await view(id, 3)
    release(windowed('after-2'))
    await slow
    await download(id)

    expect(lastSent()?.[0]).toEqual({
      query: typed,
      positions: 'after-3',
      csv: true
    })
  })

  test('reads to the end when the furthest window loaded reached it, whatever positions it holds', async () => {
    vi.mocked(queryExplore)
      .mockResolvedValueOnce(windowed('after-1'))
      .mockResolvedValueOnce(windowed(null, true))
      .mockResolvedValueOnce(answer())

    const id = await holdRun(owner, typed)

    await view(id)
    await view(id, 2)
    await download(id)

    expect(lastSent()?.[0]).toEqual({
      query: typed,
      untilEnd: true,
      csv: true
    })
  })

  test('says a run never held has expired, reading nothing', async () => {
    expect(
      await download('0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b')
    ).toMatchObject({
      kind: 'page',
      page: { q: '', run: null, notice: { kind: 'expired' } }
    })
    expect(queryExplore).not.toHaveBeenCalled()
    expect(findVocabulary).toHaveBeenCalledExactlyOnceWith()
  })

  test('draws the run’s page GAS refused with the vocabulary its refusal carried', async () => {
    const vocabulary = {
      sources: [{ name: 'cases', label: 'Cases', time: null, paths: [] }]
    }

    vi.mocked(queryExplore).mockRejectedValue(
      new Boom.Boom('Response Error: 400', {
        statusCode: 400,
        data: {
          isResponseError: true,
          payload: { reason: 'QUERY_REFUSED', vocabulary }
        }
      })
    )

    const id = await holdRun(owner, typed)

    expect(await download(id)).toMatchObject({
      page: { result: { outcome: 'failed' }, vocabulary }
    })
    expect(findVocabulary).not.toHaveBeenCalled()
  })

  test('says why on the run’s page when GAS can’t read it', async () => {
    vi.mocked(queryExplore).mockRejectedValue(Boom.internal())

    const id = await holdRun(owner, typed)

    expect(await download(id)).toMatchObject({
      kind: 'page',
      page: {
        q: typed,
        run: { id, page: 1 },
        result: { outcome: 'failed' },
        previous: null,
        notice: null,
        recent: [{ q: typed }]
      }
    })
  })
})
