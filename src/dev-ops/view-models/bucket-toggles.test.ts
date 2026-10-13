import { outboxBucket, toggledBucket } from '../use-cases/test-fixtures.ts'
import { shownFacts, withShown, withToggled } from './bucket-toggles.ts'

describe('shownFacts', () => {
  test.each([
    [{}, []],
    [{ show: '' }, []],
    [{ show: 'eventType' }, ['eventType']],
    [{ show: 'eventType,archived' }, ['eventType', 'archived']]
  ])('reads %o as %o', (filters, facts) => {
    expect(shownFacts(filters)).toEqual(facts)
  })
})

describe('withShown', () => {
  test('counts a fact filtered by a value its toggle hides as shown', () => {
    expect(withShown(toggledBucket, { eventType: 'Audit' })).toEqual({
      eventType: 'Audit',
      show: 'eventType'
    })
  })

  test.each([
    ['a value the toggle does not hide', { eventType: 'Unrecognised' }],
    ['no filter on the fact', { status: 'DEAD_LETTER' }],
    ['a fact that is already shown', { eventType: 'Audit', show: 'eventType' }]
  ])('leaves %s as it is', (_name, filters) => {
    expect(withShown(toggledBucket, filters)).toBe(filters)
  })

  test('leaves a bucket with no toggle alone', () => {
    const filters = { eventType: 'Audit' }

    expect(withShown(outboxBucket, filters)).toBe(filters)
  })
})

describe('withToggled', () => {
  test('shows a fact beside those already shown', () => {
    expect(
      withToggled(toggledBucket, { show: 'archived' }, 'eventType')
    ).toEqual({ show: 'archived,eventType' })
  })

  test('stops showing a fact, and drops the key with the last one', () => {
    expect(
      withToggled(toggledBucket, { show: 'eventType' }, 'eventType')
    ).toEqual({ show: undefined, eventType: undefined })
  })

  test('drops a hidden value with the toggle that showed it, and keeps any other', () => {
    expect(
      withToggled(
        toggledBucket,
        { show: 'eventType', eventType: 'Audit' },
        'eventType'
      ).eventType
    ).toBeUndefined()
    expect(
      withToggled(
        toggledBucket,
        { show: 'eventType', eventType: 'Unrecognised' },
        'eventType'
      ).eventType
    ).toBe('Unrecognised')
  })
})
