import {
  BSON,
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID
} from 'bson'

import { fullCatalogue, queuesApartCatalogue } from './test-fixtures.ts'
import {
  findOthersItem,
  findExample,
  opensInExplore,
  toFoundRecord,
  toListQuery,
  toLookup,
  toQueryText,
  toIdText,
  toQuoted,
  toTooLong
} from './explore-queries.ts'
import type { ListLook } from './explore-queries.ts'

describe('toQuoted', () => {
  test.each([
    ['Hilltop Farm', "'Hilltop Farm'"],
    ["O'Brien", "'O\\'Brien'"],
    ['a\\b', "'a\\\\b'"],
    ['two\nlines', "'two\\\nlines'"]
  ])('quotes %s as the language reads it back', (value, quoted) => {
    expect(toQuoted(value)).toBe(quoted)
  })
})

/** As GAS sends a record's `_id`: base64 BSON of `{ _id }`. */
const idOf = (_id: unknown) =>
  Buffer.from(BSON.serialize({ _id })).toString('base64')

/** A date's milliseconds written into its BSON by hand, as `bson` won't make one past JavaScript's range. */
const dateIdOf = (ms: bigint) => {
  const bytes = Buffer.from(BSON.serialize({ _id: new Date(0) }))

  bytes.writeBigInt64LE(ms, 9)

  return bytes.toString('base64')
}

describe('toIdText', () => {
  test.each([
    [
      'an ObjectId',
      idOf(new ObjectId('6741a0c2e4b0f1a2b3c4d5e6')),
      "ObjectId('6741a0c2e4b0f1a2b3c4d5e6')"
    ],
    ['text, escaped', idOf("WMP-it's\nnext"), "'WMP-it\\'s\\\nnext'"],
    ['an Int32', idOf(new Int32(5)), '5'],
    ['a Double', idOf(new Double(1.5)), '1.5'],
    ['minus zero', idOf(new Double(-0)), '-0'],
    ['infinity', idOf(Infinity), 'Infinity'],
    ['not a number', idOf(NaN), 'NaN'],
    [
      'a Long past a double',
      idOf(Long.fromString('9007199254740993')),
      "Long('9007199254740993')"
    ],
    [
      'a date',
      idOf(new Date('2026-11-20T10:00:00.000Z')),
      "ISODate('2026-11-20T10:00:00.000Z')"
    ],
    [
      'a date past what a date shows',
      dateIdOf(9_000_000_000_000_000n),
      "ISODate('Invalid Date')"
    ],
    ['a Decimal128', idOf(new Decimal128('1.10')), "Decimal128('1.10')"],
    [
      'binary',
      idOf(new Binary(Buffer.from('hi'), 0)),
      "Binary.createFromBase64('aGk=', 0)"
    ],
    [
      'old binary, its inner length left out',
      idOf(new Binary(Buffer.from('hi'), 2)),
      "Binary.createFromBase64('aGk=', 2)"
    ],
    [
      'a UUID',
      idOf(new UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')),
      "UUID('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')"
    ],
    [
      'a timestamp',
      idOf(new Timestamp({ t: 5, i: 2 })),
      'Timestamp({ t: 5, i: 2 })'
    ],
    ['a pattern', idOf(new BSONRegExp('a/b', 'i')), '/a\\/b/i'],
    [
      'a pattern, its escapes kept and line breaks escaped',
      idOf({ p: new BSONRegExp('a\\/b\nc', 'm') }),
      '{ p: /a\\/b\\nc/m }'
    ],
    [
      'a pattern, an escaped line break as its escape',
      idOf({ p: new BSONRegExp('a\\\nb\\\\\nc', '') }),
      '{ p: /a\\nb\\\\\\nc/ }'
    ],
    ['MinKey', idOf(new MinKey()), 'MinKey()'],
    ['MaxKey', idOf(new MaxKey()), 'MaxKey()'],
    ['code', idOf(new Code('x()')), "Code('x()')"],
    [
      'code with its scope',
      idOf(new Code('x()', { a: 1 })),
      "Code('x()', { a: 1 })"
    ],
    ['a symbol', idOf(new BSONSymbol('s')), "BSONSymbol('s')"],
    ['true', idOf(true), 'true'],
    ['null', idOf(null), 'null'],
    [
      'an object, its keys bare unless they need quotes',
      idOf({ a: 1, $b: [1, 'x'], 'c-d': {} }),
      "{ a: 1, '$b': [1, 'x'], 'c-d': {} }"
    ],
    [
      'bytes that aren’t BSON, without failing',
      'AAAA',
      '(not readable as BSON)'
    ]
  ])('writes %s as mongosh does', (_, id, text) => {
    expect(toIdText(id)).toBe(text)
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
    const events = fullCatalogue.buckets.find(({ id }) => id === 'gas.events')!

    expect(
      toListQuery(
        {
          ...events,
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

  test.each([
    [[], "{ service: 'GAS', status: 'DEAD_LETTER' }"],
    [['inbox'], "{ service: 'GAS', box: 'inbox', status: 'DEAD_LETTER' }"],
    [['outbox', 'inbox'], "{ service: 'GAS', status: 'DEAD_LETTER' }"]
  ])(
    'an Events page with %j picked names its box only when one queue is',
    (box, filter) => {
      const events = fullCatalogue.buckets.find(
        ({ id }) => id === 'gas.events'
      )!

      expect(
        toListQuery(events, look({ facts: { box, status: ['DEAD_LETTER'] } }))
      ).toContain(filter)
    }
  )

  test.each(['gas.outbox', 'cw.inbox'])(
    'a queue’s own list, %s, has no Explore',
    (id) => {
      const queue = queuesApartCatalogue.buckets.find(
        (bucket) => bucket.id === id
      )!

      expect(opensInExplore(queue)).toBe(false)
    }
  )

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

describe('toExamples', () => {
  const now = new Date('2026-11-17T09:00:00.000Z')

  test('lists each recent Grassland application’s parcels by their IDs, as one phase holds them', () => {
    expect(findExample('grasslands-last-30-days', now)?.q).toBe(
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
