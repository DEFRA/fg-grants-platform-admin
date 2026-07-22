import { formatCurrency } from './format-currency.ts'

describe('formatCurrency', () => {
  test('formats as GBP by default', () => {
    expect(formatCurrency('20000000')).toBe('£20,000,000.00')
  })

  test('formats with the given locale and currency', () => {
    expect(formatCurrency('5500000', 'en-US', 'USD')).toBe('$5,500,000.00')
  })
})
