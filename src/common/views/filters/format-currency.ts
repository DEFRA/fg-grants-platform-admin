export const formatCurrency = (
  value: number | string,
  locale = 'en-GB',
  currency = 'GBP'
) => {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  })

  return formatter.format(Number(value))
}
