import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import { toRecordList } from './record-list.view-model.ts'
import type {
  RecordListEntry,
  RecordListPage
} from './record-list.view-model.ts'

const now = new Date('2026-09-30T15:17:31.000Z')

const entry = (overrides: Partial<RecordListEntry> = {}): RecordListEntry => ({
  href: '/dev-ops/cases/woodland/f02-7d8-a61',
  ref: 'f02-7d8-a61',
  code: 'woodland',
  position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
  createdAt: '2026-09-30T15:10:31.000Z',
  replaced: false,
  closedAt: null,
  ...overrides
})

const listOf = (
  page: Partial<RecordListPage> = {},
  failure: { unavailable?: boolean; refused?: boolean } = {}
) => ({
  page: {
    entries: [entry()],
    pagination: { endCursor: 'NEXT', hasNextPage: true },
    total: { count: 45, capped: false },
    codes: ['woodland'],
    ...page
  },
  unavailable: false,
  refused: false,
  ...failure
})

describe('toRecordList', () => {
  test('draws a closing date as stored, on a list that shows them', () => {
    const { rows } = toRecordList(
      caseType,
      listOf({ entries: [entry({ closedAt: '2026-09-30T14:17:31.000Z' })] }),
      {},
      null,
      now
    )

    expect(rows[0].closed?.instant).toBe('2026-09-30T14:17:31Z')
  })

  test('draws no closing date on a list that has no Closed column', () => {
    const { rows } = toRecordList(
      applicationType,
      listOf({ entries: [entry({ closedAt: '2026-09-30T14:17:31.000Z' })] }),
      {},
      null,
      now
    )

    expect(rows[0].closed).toBeNull()
  })

  test('counts the result in the noun of its type', () => {
    expect(toRecordList(caseType, listOf(), {}, null, now).totalLabel).toBe(
      '45 cases'
    )
  })

  test('draws no band over an empty list', () => {
    expect(
      toRecordList(caseType, listOf({ entries: [] }), {}, null, now).totalLabel
    ).toBeNull()
  })

  test('keeps a chosen code a later page did not list, in order', () => {
    const { codeFilters } = toRecordList(
      caseType,
      listOf({ codes: undefined }),
      { code: 'frps-private-beta' },
      null,
      now
    )

    expect(
      codeFilters.map(({ label, active }) => `${label}:${active}`)
    ).toEqual(['All:false', 'frps-private-beta:true'])
  })

  test('links the next page under the list path, with its filters', () => {
    expect(
      toRecordList(caseType, listOf(), { code: 'woodland' }, null, now).nextHref
    ).toBe('/dev-ops/cases?cursor=NEXT&code=woodland')
  })

  test('links no next page once the last is in', () => {
    expect(
      toRecordList(
        caseType,
        listOf({ pagination: { endCursor: null, hasNextPage: false } }),
        {},
        null,
        now
      ).nextHref
    ).toBeNull()
  })

  test('passes a failed read on', () => {
    expect(
      toRecordList(
        applicationType,
        listOf({ entries: [] }, { refused: true }),
        {},
        null,
        now
      )
    ).toMatchObject({ refused: true, unavailable: false, rows: [] })
  })
})
