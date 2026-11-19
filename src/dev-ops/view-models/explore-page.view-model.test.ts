import type { ExploreAnswer } from '../use-cases/explore-calls.ts'
import type { ExplorePageData } from '../use-cases/explore-page.ts'
import { toExplorePage } from './explore-page.view-model.ts'
import { toTimes } from './times.ts'

const row = {
  open: null,
  cells: { c0: 'wmp-aa1-bb2' }
}

const applications = (overrides: Partial<ExploreAnswer>): ExploreAnswer => ({
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'exact',
  columns: [{ key: 'c0', label: 'Reference', kind: 'text', aggregate: false }],
  rows: [row],
  count: { n: 1, capped: false },
  groups: false,
  unwound: false,
  partial: false,
  window: null,
  unseen: [],
  ...overrides
})

const rows = (n: number) => Array.from({ length: n }, () => row)

const countOf = (answer: ExploreAnswer): string | null | undefined => {
  const page: ExplorePageData = {
    q: 'db.applications.find().limit(10000)',
    run: { id: 'run-1', page: 1 },
    result: { outcome: 'read', answer },
    previous: null,
    notice: null,
    recent: [],
    vocabulary: null
  }

  return toExplorePage({
    ...page,
    times: toTimes('utc'),
    now: new Date(),
    arrived: false
  }).results?.count
}

describe('toExplorePage’s count', () => {
  test.each([
    [
      'the first 5,000 when a LIMIT over the cap matched more',
      applications({
        rows: rows(5000),
        count: { n: 6000, capped: false }
      }),
      '6,000 applications, the first 5,000'
    ],
    [
      'every row when a LIMIT over the cap matched fewer than it reads',
      applications({
        rows: rows(20),
        count: { n: 20, capped: false }
      }),
      '20 applications'
    ],
    [
      'every group when a LIMIT over the cap found fewer',
      applications({
        rows: rows(20),
        mode: 'groups',
        groups: true,
        count: { n: 9000, capped: false, groups: 20 }
      }),
      '20 groups'
    ]
  ])('says %s', (_, answer, count) => {
    expect(countOf(answer)).toBe(count)
  })
})

describe('toExplorePage’s footer after a restore GAS stopped', () => {
  const footerOf = (stopped: { statusCode: number; code: string }) =>
    toExplorePage({
      q: 'db.applications.find()',
      run: { id: 'run-1', page: 2, through: 3, windowRows: [1, 1], stopped },
      result: {
        outcome: 'read',
        answer: applications({
          read: 'windowed',
          count: null,
          rows: rows(2),
          window: { to: null, end: false, positions: 'p' }
        })
      },
      previous: null,
      notice: null,
      recent: [],
      vocabulary: null,
      times: toTimes('utc'),
      now: new Date(),
      arrived: false
    }).results?.footer

  test('offers Retry of every window', () => {
    expect(footerOf({ statusCode: 504, code: 'TIMED_OUT' })).toEqual({
      state: 'error',
      text: 'Couldn’t load more applications.',
      retryHref: '/dev-ops/explore?run=run-1&through=3'
    })
  })
})

describe('toExplorePage’s addresses past what a restore draws', () => {
  const pageOf = (page: number) =>
    toExplorePage({
      q: 'db.applications.find()',
      run: { id: 'run-1', page, restorable: 2 },
      result: {
        outcome: 'read',
        answer: applications({
          read: 'windowed',
          count: null,
          rows: rows(1),
          window: { to: null, end: false, positions: 'p' }
        })
      },
      previous: null,
      notice: null,
      recent: [],
      vocabulary: null,
      times: toTimes('utc'),
      now: new Date(),
      arrived: false
    }).results

  test('a window past it is restored on its own page, its rows coming back to it', () => {
    const results = pageOf(3)

    expect(results?.rows[0].restoreHref).toBe(
      '/dev-ops/explore?run=run-1&page=3'
    )
    expect(results?.footer).toMatchObject({
      restoreHref: '/dev-ops/explore?run=run-1&page=3'
    })
  })

  test('a window within it: its rows have no address of their own, so the loader’s address keeps every window', () => {
    expect(pageOf(2)?.rows[0].restoreHref).toBeNull()
  })
})
