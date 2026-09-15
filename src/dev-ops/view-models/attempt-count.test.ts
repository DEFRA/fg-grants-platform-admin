import { toAttemptCount } from './attempt-count.ts'

describe('toAttemptCount', () => {
  test.each([
    ['3/5', { made: 3, allowed: 5 }],
    ['0/5', { made: 0, allowed: 5 }],
    ['12/5', { made: 12, allowed: 5 }]
  ])('reads %s as the attempts made and allowed', (label, count) => {
    expect(toAttemptCount(label)).toEqual(count)
  })

  test.each([['-'], [''], ['unknown'], ['3/'], ['/5'], ['3/5/7'], ['-1/5']])(
    'reads no count from %j',
    (label) => {
      expect(toAttemptCount(label)).toBeNull()
    }
  )

  test('reads no count from a value that is not a string at all', () => {
    expect(toAttemptCount(5 as unknown as string)).toBeNull()
    expect(toAttemptCount(undefined as unknown as string)).toBeNull()
  })
})
