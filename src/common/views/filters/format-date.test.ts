import { formatDate } from './format-date.ts'

describe('formatDate', () => {
  beforeAll(() => {
    vi.useFakeTimers({
      now: new Date('2023-02-01')
    })
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  test('formats an ISO string and a Date alike by default', () => {
    expect(formatDate('2023-02-01T11:40:02.242Z')).toBe('Wed 1st February 2023')
    expect(formatDate(new Date())).toBe('Wed 1st February 2023')
  })

  test('formats with the given format', () => {
    expect(
      formatDate('2023-02-01T11:40:02.242Z', "h:mm aaa 'on' EEEE do MMMM yyyy")
    ).toBe('11:40 am on Wednesday 1st February 2023')
  })
})
