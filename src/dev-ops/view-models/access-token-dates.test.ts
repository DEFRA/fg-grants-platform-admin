import { toExpiryDay, toUkDate, toUkEndOfDay } from './access-token-dates.ts'

describe('toExpiryDay', () => {
  test.each([
    ['this year, in winter', '2026-11-20T09:05:00.000Z', '20 Nov 2026'],
    ['another year', '2027-02-01T23:59:59.000Z', '1 Feb 2027'],
    ['a past year', '2025-03-09T08:30:00.000Z', '9 Mar 2025'],
    ['September, as `Sep`', '2027-09-01T12:00:00.000Z', '1 Sep 2027']
  ])('writes a day %s with its year, and no time', (_name, instant, text) => {
    expect(toExpiryDay(new Date(instant))).toBe(text)
  })

  test('takes the day and year from UK time, not UTC', () => {
    expect(toExpiryDay(new Date('2026-12-31T23:30:00.000Z'))).toBe(
      '31 Dec 2026'
    )
    expect(toExpiryDay(new Date('2027-06-30T23:00:00.000Z'))).toBe('1 Jul 2027')
  })
})

describe('toUkEndOfDay', () => {
  test.each([
    ['a winter day', '2026-12-01', '2026-12-01T23:59:59.000Z'],
    ['a summer day', '2027-06-01', '2027-06-01T22:59:59.000Z'],
    ['the day the clocks go forward', '2027-03-28', '2027-03-28T22:59:59.000Z'],
    ['the day the clocks go back', '2026-10-25', '2026-10-25T23:59:59.000Z']
  ])('ends %s at 23:59:59 UK time', (_name, date, instant) => {
    expect(toUkEndOfDay(date).toISOString()).toBe(instant)
  })
})

describe('toUkDate', () => {
  test('reads the day as the UK has it, which in summer runs an hour ahead of UTC', () => {
    expect(toUkDate(new Date('2027-07-15T23:30:00.000Z'))).toBe('2027-07-16')
    expect(toUkDate(new Date('2027-01-15T23:30:00.000Z'))).toBe('2027-01-15')
  })
})
