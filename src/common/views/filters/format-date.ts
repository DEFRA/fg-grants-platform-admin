import { format, isDate, parseISO } from 'date-fns'

export const formatDate = (
  value: string | Date,
  formattedDateStr = 'EEE do MMMM yyyy'
) => {
  const date = isDate(value) ? value : parseISO(value)

  return format(date, formattedDateStr)
}
