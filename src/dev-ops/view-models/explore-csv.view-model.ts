import type { ExploreAnswer, ExploreCell } from '../use-cases/explore-calls.ts'

/** A spreadsheet would read a text starting with one of these as a formula. */
const formulaStart = /^[=+\-@\t\r]/

const toSafeText = (text: string): string =>
  formulaStart.test(text) ? `'${text}` : text

const toQuotedField = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text

const toItem = (item: ExploreCell): string => {
  if (Array.isArray(item)) {
    return `[${item.map(toItem).join(', ')}]`
  }

  return typeof item === 'object' && item !== null ? item.text : String(item)
}

const toText = (cell: Exclude<ExploreCell, number | null>): string =>
  Array.isArray(cell) ? cell.map(toItem).join('; ') || '[]' : toItem(cell)

/** Numbers as they are, dates as GAS sends them (ISO), an object as the inline text GAS wrote, a list's values joined with "; ", a list inside it in brackets. */
const toField = (cell: ExploreCell | undefined): string => {
  if (typeof cell === 'number') {
    return String(cell)
  }

  return cell ? toQuotedField(toSafeText(toText(cell))) : ''
}

const toLine = (fields: string[]): string => `${fields.join(',')}\r\n`

/** The answer's columns and rows as CSV: a header line of the columns' labels, then a line a row. */
export const toExploreCsv = ({ columns, rows }: ExploreAnswer): string =>
  [
    toLine(columns.map(({ label }) => toQuotedField(toSafeText(label)))),
    ...rows.map((row) =>
      toLine(columns.map(({ key }) => toField(row.cells[key])))
    )
  ].join('')

/** A CSV GAS marks partial, because a window ended early, says so in its name. */
export const toCsvFilename = ({ source, partial }: ExploreAnswer): string =>
  `explore-${source.name.replace(/[^a-z0-9-]/gi, '')}${partial ? '-partial' : ''}.csv`
