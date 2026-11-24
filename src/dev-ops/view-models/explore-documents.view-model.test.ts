import { BSON, ObjectId } from 'bson'

import type { ExploreAnswer, ExploreRow } from '../use-cases/explore-calls.ts'
import { readBase64, toPrinted } from './explore-bson.ts'
import {
  inPlaceBytes,
  inPlaceValues,
  toDocument,
  toMalformedList,
  toMalformedShown
} from './explore-documents.view-model.ts'
import type { DocumentWhere } from './explore-documents.view-model.ts'

const base64Of = (document: object): string =>
  Buffer.from(BSON.serialize(document)).toString('base64')

const oid = '6741a0c2e4b0f1a2b3c4d5e6'
const run = '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'
const appId = base64Of({ _id: new ObjectId(oid) })

const answer = (overrides: Partial<ExploreAnswer> = {}): ExploreAnswer => ({
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'exact',
  columns: [],
  rows: [],
  count: null,
  groups: false,
  unwound: false,
  partial: false,
  unseen: [],
  window: null,
  ...overrides
})

/** A record's row as a Documents page reads it: its start and what its document as fetched prints. */
const startRow = (overrides: Partial<ExploreRow> = {}): ExploreRow => ({
  open: { kind: 'application', code: 'woodland', ref: 'wmp-1' },
  cells: {},
  id: appId,
  at: [],
  start: {
    doc: base64Of({ _id: new ObjectId(oid), clientRef: 'wmp-1' }),
    cut: false
  },
  printed: { bytes: 60, values: 2 },
  context: null,
  docNote: null,
  ...overrides
})

/** A record's row as Show it reads it: its document whole, and its start. */
const readRow = (overrides: Partial<ExploreRow> = {}): ExploreRow => {
  const doc =
    overrides.doc === undefined
      ? base64Of({ _id: new ObjectId(oid), clientRef: 'wmp-1' })
      : overrides.doc

  return {
    open: { kind: 'application', code: 'woodland', ref: 'wmp-1' },
    cells: {},
    id: appId,
    at: [],
    doc,
    start: doc ? { doc, cut: false } : null,
    context: null,
    docNote: null,
    ...overrides
  }
}

const place = { id: 'row-1-4', restoreHref: null, number: 4 }

const documentOf = (
  row: ExploreRow,
  where: DocumentWhere = 'list',
  read: Partial<ExploreAnswer> = {}
) => toDocument(answer(read), row, place, { run, where })

const showFields = [
  { name: 'run', value: run },
  { name: 'show', value: appId },
  { name: 'result', value: '4' }
]

describe('a record’s row in a run’s list', () => {
  test('is a line of its start, opened by Show it’s form, with no link to its record', () => {
    const document = documentOf(startRow())

    expect(document).not.toHaveProperty('open')
    expect(document).toEqual({
      id: 'row-1-4',
      restoreHref: null,
      label: 'Result 4',
      lineId: 'result-4',
      line: {
        kind: 'start',
        doc: {
          t: 'object',
          entries: [
            ['_id', { t: 'objectId', v: oid }],
            ['clientRef', { t: 'string', v: 'wmp-1' }]
          ]
        },
        cut: false,
        quotedKey: false
      },
      aside: null,
      opens: {
        kind: 'form',
        form: {
          action: '/dev-ops/explore',
          label: 'Show result 4',
          fields: showFields
        },
        fields: { run, show: appId, result: '4' }
      }
    })
  })

  test('says a cut start is cut', () => {
    const start = { doc: base64Of({ a: 'x'.repeat(200) }), cut: true }
    const document = documentOf(startRow({ start }))

    expect(document.line).toMatchObject({ kind: 'start', cut: true })
    expect(toMalformedList(answer({ rows: [startRow({ start })] }))).toBeNull()
  })

  test('is a malformed answer when its start is cut but prints within the line', () => {
    const start = { doc: base64Of({ a: 'x'.repeat(144) }), cut: true }

    expect(toMalformedList(answer({ rows: [startRow({ start })] }))).toBe(
      'a cut start that prints whole'
    )
  })

  test('draws a start that prints within the line whole when nothing was cut', () => {
    const start = { doc: base64Of({ a: 'x'.repeat(144) }), cut: false }

    expect(toMalformedList(answer({ rows: [startRow({ start })] }))).toBeNull()
  })

  test.each([
    [
      'no start and no note',
      { start: null, docNote: null },
      'a row with no start'
    ],
    [
      'no start, only changed',
      { start: null, docNote: { changed: true as const } },
      'a row with no start'
    ],
    [
      'no start, past what one answer prints',
      { start: null, docNote: { later: 2_000_000, values: 10 } },
      'a row with no start'
    ],
    [
      'a start beside gone',
      { docNote: { gone: true as const } },
      'a start with a note'
    ],
    ['a start with no _id', { id: null }, 'a start with no _id']
  ])('is a malformed answer with %s', (_, row, malformed) => {
    expect(toMalformedList(answer({ rows: [startRow(row)] }))).toBe(malformed)
  })

  test('posts an event’s service and box, and the places $unwind took it from', () => {
    const document = documentOf(
      startRow({ at: [3, null], context: { service: 'CW', box: 'inbox' } })
    )

    expect(document.opens).toMatchObject({
      kind: 'form',
      form: {
        fields: [
          ...showFields,
          { name: 'at', value: '3,null' },
          { name: 'service', value: 'CW' },
          { name: 'box', value: 'inbox' }
        ]
      }
    })
  })

  test('opens in place at 1 MiB and 50,000 values', () => {
    const printed = { bytes: inPlaceBytes, values: inPlaceValues }

    expect(documentOf(startRow({ printed })).opens).toMatchObject({
      kind: 'form'
    })
  })

  test.each([
    ['a byte past 1 MiB', { bytes: inPlaceBytes + 1, values: 10 }],
    ['a value past 50,000', { bytes: 100, values: inPlaceValues + 1 }],
    ['with nothing said of its size', null]
  ])(
    'opens with its caret, closed, on its line, why and Show in new tab to its own page, %s',
    (_, printed) => {
      expect(documentOf(startRow({ printed })).opens).toEqual({
        kind: 'show',
        open: false,
        form: {
          action: '/dev-ops/explore',
          label: 'Show result 4',
          fields: showFields
        },
        text: 'This application’s document is too large to print on a page.',
        buttonLabel: 'Show in new tab, result 4'
      })
    }
  )

  test('says it changed since it was found under its line', () => {
    const document = documentOf(startRow({ docNote: { changed: true } }))

    expect(document.aside).toBe(
      'Changed since it was found: it may no longer match the filter.'
    )
    expect(document.opens).toMatchObject({ kind: 'form' })
  })

  test.each([
    [
      'gone',
      { start: null, printed: null, docNote: { gone: true as const } },
      'This application no longer exists. Run the query again.'
    ],
    [
      'made too large by its projection',
      { start: null, printed: null, docNote: { tooLarge: true as const } },
      'This projection makes the document larger than mongod allows.'
    ],
    [
      'a start that isn’t BSON',
      { start: { doc: 'AAAA', cut: false } },
      'This application’s document isn’t readable as BSON.'
    ]
  ])(
    'says why it has no line when %s, with nothing to open',
    (_, row, text) => {
      const document = documentOf(startRow(row))

      expect(document.line).toEqual({
        kind: 'note',
        note: { text, action: null }
      })
      expect(document.opens).toBeNull()
    }
  )
})

describe('a group, value or count', () => {
  const workedOut = (doc: object): ExploreRow => ({
    open: null,
    cells: {},
    id: null,
    at: null,
    doc: base64Of(doc),
    start: { doc: base64Of(doc), cut: false },
    context: null,
    docNote: null
  })

  test.each([
    ['groups', { _id: 'AWAITING', cases: 12 }, 'object'],
    ['distinct', { v: 'AWAITING' }, 'string'],
    ['count', { n: 3 }, 'int32']
  ] as const)(
    'opens its %s printout in the page, read by nothing',
    (mode, doc, t) => {
      const document = documentOf(workedOut(doc), 'list', { mode })

      expect(document.line).toMatchObject({ kind: 'start', cut: false })
      expect(document.opens).toMatchObject({
        kind: 'page',
        open: false,
        printout: { doc: { t }, context: null, related: null, note: null }
      })
    }
  )

  test('prints its line from its start, its printout from its whole document', () => {
    const doc = { _id: 'AWAITING', list: Array.from({ length: 200 }, () => 1) }
    const start = { _id: 'AWAITING', list: Array.from({ length: 80 }, () => 1) }
    const document = documentOf(
      { ...workedOut(doc), start: { doc: base64Of(start), cut: true } },
      'list',
      { mode: 'groups' }
    )

    expect(document.line).toEqual({
      kind: 'start',
      doc: toPrinted(readBase64(base64Of(start))),
      cut: true,
      quotedKey: false
    })
    expect(document.opens).toMatchObject({
      printout: { doc: toPrinted(readBase64(base64Of(doc))) }
    })
  })

  test('prints a value’s line from its start’s one value', () => {
    const start = base64Of({ v: 'x'.repeat(200) })
    const document = documentOf(
      {
        ...workedOut({ v: 'x'.repeat(5000) }),
        start: { doc: start, cut: true }
      },
      'list',
      { mode: 'distinct' }
    )

    expect(document.line).toMatchObject({
      kind: 'start',
      doc: { t: 'string', v: 'x'.repeat(200) },
      cut: true
    })
  })

  test.each([
    ['no start', { start: undefined }, 'a document with no start'],
    [
      'a cut start that prints whole',
      { start: { doc: base64Of({ _id: 'A' }), cut: true } },
      'a cut start that prints whole'
    ]
  ])('is malformed with %s', (_, overrides, malformed) => {
    const row = { ...workedOut({ _id: 'A' }), ...overrides }

    expect(toMalformedList(answer({ mode: 'groups', rows: [row] }))).toBe(
      malformed
    )
  })

  test('is well formed with its start', () => {
    expect(
      toMalformedList(answer({ mode: 'count', rows: [workedOut({ n: 3 })] }))
    ).toBeNull()
  })
})

describe('a Show it run’s row', () => {
  test('prints its line from its start, its printout from its whole document', () => {
    const doc = {
      _id: new ObjectId(oid),
      a: Array.from({ length: 500 }, () => 1)
    }
    const start = {
      _id: new ObjectId(oid),
      a: Array.from({ length: 80 }, () => 1)
    }
    const document = documentOf(
      readRow({
        doc: base64Of(doc),
        start: { doc: base64Of(start), cut: true }
      }),
      'shown'
    )

    expect(document.line).toEqual({
      kind: 'start',
      doc: toPrinted(readBase64(base64Of(start))),
      cut: true,
      quotedKey: false
    })
    expect(document.opens).toMatchObject({
      printout: { doc: toPrinted(readBase64(base64Of(doc))) }
    })
  })

  test.each([
    [
      'its document with no start',
      { start: undefined },
      'a document with no start'
    ],
    [
      'a cut start that prints whole',
      { start: { doc: base64Of({ _id: 1 }), cut: true } },
      'a cut start that prints whole'
    ]
  ])('is malformed with %s', (_, overrides, malformed) => {
    expect(toMalformedShown(answer({ rows: [readRow(overrides)] }))).toBe(
      malformed
    )
  })

  test('is well formed with its start, or with no document and none', () => {
    expect(toMalformedShown(answer({ rows: [readRow()] }))).toBeNull()
    expect(
      toMalformedShown(
        answer({ rows: [readRow({ doc: null, docNote: { gone: true } })] })
      )
    ).toBeNull()
  })

  test('is drawn open, its document whole with what it sits beside', () => {
    const document = documentOf(
      readRow({
        open: { kind: 'grant', code: 'woodland', version: '1.2.0' },
        docNote: { changed: true },
        context: { definition: base64Of({ $schema: 'x' }) }
      }),
      'shown'
    )

    expect(document.aside).toBeNull()
    expect(document.opens).toMatchObject({
      kind: 'page',
      open: true,
      printout: {
        doc: { t: 'object' },
        related: {
          title: 'Its grant definition (grants: woodland 1.2.0)',
          label: 'Its grant definition (grants: woodland 1.2.0), result 4'
        },
        changed:
          'Changed since it was found: it may no longer match the filter.'
      }
    })
  })

  test('offers Download JSON for a document too large to print on a page', () => {
    const document = documentOf(
      readRow({ doc: null, docNote: { later: 16_000_000, values: 900_000 } }),
      'shown'
    )

    expect(document.line).toEqual({
      kind: 'note',
      note: {
        text: 'This application’s document is too large to print on a page. Download JSON holds it whole.',
        action: 'download',
        label: 'Download JSON'
      }
    })
    expect(document.opens).toBeNull()
  })
})

describe('an open answered in place', () => {
  const showItOpens = {
    kind: 'show',
    open: true,
    form: {
      action: '/dev-ops/explore',
      label: 'Show result 4',
      fields: showFields
    },
    text: 'This application’s document is too large to print on a page.',
    buttonLabel: 'Show in new tab, result 4'
  }

  test('prints its document open when it is still within what a page prints', () => {
    expect(documentOf(readRow(), 'opened').opens).toMatchObject({
      kind: 'page',
      open: true
    })
  })

  test.each([
    [
      'its document grew past 1 MiB',
      readRow({ doc: base64Of({ big: 'x'.repeat(inPlaceBytes) }) })
    ],
    [
      'its document holds more than 50,000 values',
      readRow({
        doc: base64Of({ list: Array.from({ length: inPlaceValues }, () => 1) })
      })
    ],
    [
      'its joined record makes it pass 1 MiB',
      readRow({
        open: { kind: 'grant', code: 'woodland', version: '1.2.0' },
        context: {
          definition: base64Of({ big: 'x'.repeat(inPlaceBytes - 40) })
        }
      })
    ]
  ])(
    'keeps its line, drawn open with why and Show in new tab under it, when %s',
    (_, row) => {
      const document = documentOf(row, 'opened')

      expect(document.lineId).toBe('result-4')
      expect(document.line).toEqual({
        kind: 'start',
        doc: toPrinted(readBase64(row.start!.doc)),
        cut: false,
        quotedKey: false
      })
      expect(document.opens).toEqual(showItOpens)
    }
  )

  test('keeps the line of its start, drawn open with why and Show in new tab under it, for a document too large for any page', () => {
    const start = base64Of({ _id: new ObjectId(oid), clientRef: 'wmp-1' })
    const document = documentOf(
      readRow({
        doc: null,
        start: { doc: start, cut: true },
        docNote: { later: 16_000_000, values: 900_000 }
      }),
      'opened'
    )

    expect(document.lineId).toBe('result-4')
    expect(document.line).toEqual({
      kind: 'start',
      doc: toPrinted(readBase64(start)),
      cut: true,
      quotedKey: false
    })
    expect(document.opens).toEqual(showItOpens)
  })

  test('draws the line of its _id open with why and Show in new tab under it for a document too large for any page when no start of it came', () => {
    const document = documentOf(
      readRow({ doc: null, docNote: { later: 16_000_000, values: 900_000 } }),
      'opened'
    )

    expect(document.lineId).toBe('result-4')
    expect(document.line).toEqual({
      kind: 'start',
      doc: { t: 'object', entries: [['_id', { t: 'objectId', v: oid }]] },
      cut: false,
      quotedKey: false
    })
    expect(document.opens).toEqual(showItOpens)
  })
})

describe('a start cut inside a key that needs quotes whole', () => {
  const doc = base64Of({ a: 'x'.repeat(200), outer: { inner: 1, cutKey: '' } })

  test('keeps the key as stored and says it is printed quoted', () => {
    const document = documentOf(
      startRow({ start: { doc, cut: true, quotedKey: true } })
    )

    expect(document.line).toEqual({
      kind: 'start',
      doc: toPrinted(readBase64(doc)),
      cut: true,
      quotedKey: true
    })
  })

  test('says nothing of quotes without it', () => {
    const document = documentOf(startRow({ start: { doc, cut: true } }))

    expect(document.line).toMatchObject({ kind: 'start', quotedKey: false })
  })
})
