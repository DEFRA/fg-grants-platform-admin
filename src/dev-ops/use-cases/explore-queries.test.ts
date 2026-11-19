import { fullCatalogue } from './test-fixtures.ts'
import {
  findOthersItem,
  findStartingPoint,
  toFoundRecord,
  toListQuery,
  toLookup,
  toQueryText,
  toQuoted,
  toTooLong
} from './explore-queries.ts'
import type { ListLook } from './explore-queries.ts'

describe('toQuoted', () => {
  test.each([
    ['Hilltop Farm', "'Hilltop Farm'"],
    ["O'Brien", "'O\\'Brien'"],
    ['a\\b', "'a\\\\b'"]
  ])('quotes %s as the language reads it back', (value, quoted) => {
    expect(toQuoted(value)).toBe(quoted)
  })
})

describe('toQueryText', () => {
  test('turns a form’s CRLF and CR line breaks into LF', () => {
    expect(toQueryText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('toTooLong', () => {
  test('refuses a query over 4,000 characters from the first character past it', () => {
    expect(toTooLong('x'.repeat(4001))).toEqual({
      outcome: 'failed',
      failure: {
        kind: 'invalid',
        error: {
          message: 'Shorten the query to 4,000 characters or fewer.',
          at: 4000,
          end: 4001
        }
      }
    })
  })

  test('takes a query of 4,000 characters', () => {
    expect(toTooLong('x'.repeat(4000))).toBeNull()
  })
})

const look = (overrides: Partial<ListLook> = {}): ListLook => ({
  facts: {},
  window: {},
  search: '',
  ...overrides
})

describe('toListQuery', () => {
  const applications = fullCatalogue.buckets.find(
    ({ id }) => id === 'gas.applications'
  )!

  test.each([
    ['sbi:200000002', "{ refs: 'sbi:200000002' }"],
    ['ref: WMP-1 ', "{ refs: 'ref:wmp-1' }"],
    ['agreement:FPTT1', "{ refs: 'agreement:fptt1' }"],
    ["ref:o'neil", "{ refs: 'ref:o\\'neil' }"]
  ])('finds a search %s by the refs, as the list finds it', (search, test) => {
    expect(toListQuery(applications, look({ search }))).toContain(test)
  })

  test.each([['nokind'], [':value'], ['ref:  ']])(
    'leaves out a search %s that names no ref',
    (search) => {
      expect(toListQuery(applications, look({ search }))).toContain(
        'db.applications.find(\n  {},'
      )
    }
  )

  test('writes a dotted fact as a quoted key, with its values as stored', () => {
    const outbox = fullCatalogue.buckets.find(({ id }) => id === 'gas.outbox')!

    expect(
      toListQuery(
        {
          ...outbox,
          facts: [
            {
              name: 'lastError.name',
              param: 'errorname',
              label: 'Error name',
              values: null,
              within: null
            }
          ]
        },
        look({ facts: { 'lastError.name': ['MongoError', 'TypeError'] } })
      )
    ).toContain("'lastError.name': { $in: ['MongoError', 'TypeError'] }")
  })

  test('times a range by the list’s own time path', () => {
    expect(
      toListQuery(
        applications,
        look({
          window: {
            from: '2026-06-30T23:00:00.000Z',
            to: '2026-07-01T22:59:59.999Z'
          }
        })
      )
    ).toContain(
      "{ createdAt: { $gte: ISODate('2026-06-30T23:00:00.000Z'), $lte: ISODate('2026-07-01T22:59:59.999Z') } }"
    )
  })

  test('opens no list it doesn’t read', () => {
    expect(toListQuery({ ...applications, id: 'gas.other' }, look())).toBeNull()
  })
})

describe('toFoundRecord', () => {
  test.each([
    [
      '/dev-ops/applications/woodland/wmp-aa1-bb2',
      {
        source: 'applications',
        noun: 'application',
        paths: {
          code: 'code',
          ref: 'clientRef',
          business: 'phases.answers.applicant.business.name',
          sbi: 'identifiers.sbi'
        },
        code: 'woodland',
        ref: 'wmp-aa1-bb2'
      }
    ],
    [
      '/dev-ops/cases/frps%20beta/CASE%2F1',
      {
        source: 'cases',
        noun: 'case',
        paths: {
          code: 'workflowCode',
          ref: 'caseRef',
          business: 'payload.answers.applicant.business.name',
          sbi: 'payload.identifiers.sbi'
        },
        code: 'frps beta',
        ref: 'CASE/1'
      }
    ],
    ['/dev-ops/applications/woodland/%E0', null],
    ['/dev-ops/applications/woodland/wmp?tab=raw', null],
    ['/dev-ops/events/gas/outbox/1', null]
  ])('reads %s', (path, record) => {
    expect(toFoundRecord(path)).toEqual(record)
  })
})

describe('toLookup', () => {
  test('reads the record’s business name and SBI, saying which column holds each', () => {
    expect(toLookup(toFoundRecord('/dev-ops/cases/woodland/CASE-1')!)).toEqual({
      query:
        "db.cases.find(\n  { workflowCode: 'woodland', caseRef: 'CASE-1' },\n  { business: '$payload.answers.applicant.business.name', sbi: '$payload.identifiers.sbi' }\n).limit(1)",
      columns: ['business', 'sbi']
    })
  })
})

describe('toStartingPoints', () => {
  const now = new Date('2026-11-17T09:00:00.000Z')

  test('lists each recent Grassland application’s parcels by their IDs, as one phase holds them', () => {
    expect(findStartingPoint('grasslands-last-30-days', now)?.q).toBe(
      "db.applications.find(\n  { code: 'grasslands', createdAt: { $gte: ISODate('2026-10-18') } },\n  { clientRef: 1, 'phases.answers.applicant.business.name': 1, parcels: '$phases.answers.parcels.parcelId' }\n)"
    )
  })
})

describe('findOthersItems', () => {
  test('counts the business’s cases by stage, the stage with most first', () => {
    expect(findOthersItem('cases-by-sbi')?.toQuery(' 200000002 ')).toBe(
      "db.cases.aggregate([\n  { $match: { refs: 'sbi:200000002' } },\n  { $group: { _id: '$currentStage', cases: { $sum: 1 }, latest: { $max: '$createdAt' } } },\n  { $sort: { cases: -1 } }\n])"
    )
  })
})
