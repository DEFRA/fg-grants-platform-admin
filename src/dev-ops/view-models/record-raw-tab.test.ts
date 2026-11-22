import { EJSON } from 'bson'

import { logger } from '../../common/logger.ts'
import {
  storedApplication,
  toStoredBase64
} from '../use-cases/test-fixtures.ts'
import { toRawTab, toSize } from './record-raw-tab.ts'

vi.mock(import('../../common/logger.ts'))

const copy = {
  noun: 'application',
  error: { title: 'Failed.', text: 'Try later.' }
}

const tabHref = '/dev-ops/applications/woodland/a?tab=raw'

const tooLarge = [{ section: 'raw', message: 'too large to show' }]

const document = toStoredBase64(storedApplication)

describe('toRawTab', () => {
  test('is the document as stored, typed, for the printout', () => {
    const tab = toRawTab({ document, sectionErrors: [] }, copy, tabHref)

    expect(tab.kind).toBe('document')
    expect(tab).toMatchObject({
      doc: {
        t: 'object',
        entries: expect.arrayContaining([
          ['_id', { t: 'objectId', v: '6650c1f2a9e4b1d07c20bd91' }],
          ['submittedAt', { t: 'date', v: '1790845200000' }],
          ['sequence', { t: 'int64', v: '9007199254740993' }]
        ])
      }
    })
  })

  test('copies canonical Extended JSON, which parses back to every type in stored order', () => {
    const tab = toRawTab({ document, sectionErrors: [] }, copy, tabHref)
    const ejson = 'ejson' in tab ? tab.ejson : ''

    expect(ejson).toBe(EJSON.stringify(storedApplication, { relaxed: false }))
    expect(EJSON.parse(ejson, { relaxed: false })).toEqual(storedApplication)
    expect(Object.keys(EJSON.parse(ejson))).toEqual(
      Object.keys(storedApplication)
    )
  })

  test('says the document is too large, with its size', () => {
    expect(
      toRawTab(
        { document: null, storedBytes: 2516582, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toEqual({
      kind: 'too-large',
      text: 'The stored application is 2.4 MiB, too large for this page.'
    })
  })

  test('says a document within the 1 MiB cap has too many values', () => {
    expect(
      toRawTab(
        { document: null, storedBytes: 784179, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toEqual({
      kind: 'too-large',
      text: 'The stored application is 765.8 KiB, with too many values to print on a page.'
    })
  })

  test('says a document of exactly 1 MiB has too many values', () => {
    expect(
      toRawTab(
        { document: null, storedBytes: 1048576, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toMatchObject({
      text: 'The stored application is 1 MiB, with too many values to print on a page.'
    })
  })

  test('says it is too large without a size GAS did not send', () => {
    expect(
      toRawTab(
        { document: null, storedBytes: null, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toEqual({
      kind: 'too-large',
      text: 'The stored application is too large to show on this page.'
    })
  })

  test('says the tab failed for any other Raw error', () => {
    expect(
      toRawTab(
        {
          document: null,
          sectionErrors: [
            { section: 'raw', message: "The stored document can't be read" }
          ]
        },
        copy,
        tabHref
      )
    ).toEqual({ kind: 'error', error: { ...copy.error, retryHref: tabHref } })
  })

  test('says the tab failed, logging only the kind of failure, when the bytes are not BSON', () => {
    const bytes = Buffer.from(document, 'base64')
    bytes.writeInt32LE(bytes.length + 9)

    expect(
      toRawTab(
        { document: bytes.toString('base64'), sectionErrors: [] },
        copy,
        tabHref
      )
    ).toEqual({ kind: 'error', error: { ...copy.error, retryHref: tabHref } })
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'The stored application isn’t readable as BSON: BSONOffsetError'
    )
  })

  test("ignores another section's error", () => {
    expect(
      toRawTab(
        {
          document,
          sectionErrors: [{ section: 'events', message: 'too large to show' }]
        },
        copy,
        tabHref
      ).kind
    ).toBe('document')
  })

  test.each([
    ['null', null],
    ['no document at all, as an answer of the old shape', undefined]
  ])(
    'says the tab failed, logging only the kind, when the source sent %s with no Raw error',
    (_, sent) => {
      expect(
        toRawTab({ document: sent, sectionErrors: [] }, copy, tabHref)
      ).toEqual({ kind: 'error', error: { ...copy.error, retryHref: tabHref } })
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        'The stored application is missing from the answer: no document'
      )
    }
  )
})

describe('toSize', () => {
  test.each([
    [524288, '512 KiB'],
    [1572864, '1.5 MiB'],
    [4194304, '4 MiB'],
    [1500, '1.5 KiB']
  ])('writes %i bytes as %s', (bytes, text) => {
    expect(toSize(bytes)).toBe(text)
  })
})
