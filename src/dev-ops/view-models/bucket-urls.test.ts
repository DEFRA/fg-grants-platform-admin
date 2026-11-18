import {
  applicationsBucket,
  auditedOutbox
} from '../use-cases/test-fixtures.ts'
import { fromUrlQuery, toUrlQuery, withOfferedValues } from './bucket-urls.ts'

describe('toUrlQuery', () => {
  test('spells each fact by its key, several values as a list, and keeps the time range', () => {
    expect(
      toUrlQuery(auditedOutbox, {
        status: ['DEAD_LETTER', 'FAILED'],
        'lastError.name': 'TypeError',
        from: '2026-10-08T12:00:00.000Z',
        range: '24h'
      })
    ).toEqual({
      status: ['DEAD_LETTER', 'FAILED'],
      event: undefined,
      grant: undefined,
      error: 'TypeError',
      from: '2026-10-08T12:00:00.000Z',
      to: undefined,
      range: '24h'
    })
  })

  test('spells the same fact by each list’s own key', () => {
    expect(toUrlQuery(applicationsBucket, { code: ['example-grant'] })).toEqual(
      expect.objectContaining({ grant: ['example-grant'] })
    )
  })
})

describe('fromUrlQuery', () => {
  test('reads each key back to its fact: a fact with offered values as a list, any other as one value', () => {
    expect(
      fromUrlQuery(auditedOutbox, {
        event: 'Audit',
        status: ['DEAD_LETTER', 'FAILED', 'DEAD_LETTER', ''],
        error: 'TypeError',
        range: '24h'
      })
    ).toEqual({
      eventType: ['Audit'],
      status: ['DEAD_LETTER', 'FAILED'],
      'lastError.name': 'TypeError',
      range: '24h'
    })
  })

  test('reads a fact that takes one value from the first, when the address repeats it', () => {
    expect(fromUrlQuery(auditedOutbox, { error: ['A', 'B'] })).toEqual({
      'lastError.name': 'A'
    })
  })

  test('reads no key it does not declare', () => {
    expect(
      fromUrlQuery(auditedOutbox, { eventType: 'Audit', audit: 'on' })
    ).toEqual({})
  })
})

describe('withOfferedValues', () => {
  test('keeps only the values a fact offers, and every value of a fact that offers none', () => {
    expect(
      withOfferedValues(auditedOutbox, {
        status: ['DEAD_LETTER', 'BOGUS'],
        event: 'Nope',
        error: 'anything',
        from: '2026-10-08'
      })
    ).toEqual({
      status: ['DEAD_LETTER'],
      event: [],
      error: 'anything',
      from: '2026-10-08'
    })
  })
})
