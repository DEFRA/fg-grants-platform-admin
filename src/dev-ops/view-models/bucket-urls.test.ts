import {
  applicationsBucket,
  toggledBucket
} from '../use-cases/test-fixtures.ts'
import { fromUrlQuery, toUrlQuery, unknownKeys } from './bucket-urls.ts'

describe('toUrlQuery', () => {
  test('spells each fact by its key, a toggle that is on as on, and keeps the time range', () => {
    expect(
      toUrlQuery(toggledBucket, {
        status: 'DEAD_LETTER',
        'lastError.name': 'TypeError',
        show: 'eventType',
        from: '2026-10-08T12:00:00.000Z',
        range: '24h'
      })
    ).toEqual({
      status: 'DEAD_LETTER',
      event: undefined,
      grant: undefined,
      error: 'TypeError',
      audit: 'on',
      from: '2026-10-08T12:00:00.000Z',
      to: undefined,
      range: '24h'
    })
  })

  test('leaves a toggle that is off out', () => {
    expect(toUrlQuery(toggledBucket, {})).not.toHaveProperty('audit')
  })

  test('spells the same fact by each list’s own key', () => {
    expect(toUrlQuery(applicationsBucket, { code: 'example-grant' })).toEqual(
      expect.objectContaining({ grant: 'example-grant' })
    )
  })
})

describe('fromUrlQuery', () => {
  test('reads each key back to its fact and a toggle that is on into what is shown', () => {
    expect(
      fromUrlQuery(toggledBucket, {
        event: 'Audit',
        error: 'TypeError',
        audit: 'on',
        range: '24h'
      })
    ).toEqual({
      eventType: 'Audit',
      'lastError.name': 'TypeError',
      show: 'eventType',
      range: '24h'
    })
  })

  test('reads a toggle with any other value as off', () => {
    expect(fromUrlQuery(toggledBucket, { audit: 'yes' })).toEqual({})
  })

  test('reads no key it does not declare', () => {
    expect(
      fromUrlQuery(toggledBucket, { eventType: 'Audit', show: 'eventType' })
    ).toEqual({})
  })
})

describe('unknownKeys', () => {
  test('names every key the list does not declare, with no alias for a fact’s own name', () => {
    expect(
      unknownKeys(toggledBucket, {
        status: 'FAILED',
        eventType: 'Audit',
        show: 'eventType',
        audit: 'on',
        from: '2026-10-08T12:00:00.000Z',
        colour: 'x'
      })
    ).toEqual(['eventType', 'show', 'colour'])
  })
})
