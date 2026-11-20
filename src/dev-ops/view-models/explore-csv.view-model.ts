import type {
  ExploreAnswer,
  ExploreCell,
  ExploreDownload,
  ExploreDownloadStop
} from '../use-cases/explore-calls.ts'
import { toIdText } from '../use-cases/explore-queries.ts'
import { recordsOf, toNumberText } from './explore-cells.ts'

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

/** Numbers as they are, dates as GAS sends them (ISO), an object as the inline text GAS wrote, a list's values joined with "; ", a list inside it in brackets: every value whole. */
const toField = (cell: ExploreCell | undefined): string => {
  if (typeof cell === 'number') {
    return String(cell)
  }

  return cell ? toQuotedField(toSafeText(toText(cell))) : ''
}

const toLine = (fields: string[]): string => `${fields.join(',')}\r\n`

/** Each limit a download stops at: in its file's name, and in the sentence that ends the file. */
const stops: Record<
  ExploreDownloadStop,
  (download: ExploreDownload) => { name: string; text: string }
> = {
  rows: ({ rows }) => ({
    name: `stopped-at-${rows}-rows`,
    text: `Stopped at the ${toNumberText(rows)}-row limit`
  }),
  time: () => ({
    name: 'stopped-at-time-limit',
    text: 'Stopped at the 10-second time limit'
  }),
  windows: () => ({
    name: 'stopped-at-50-windows',
    text: 'Stopped at the 50-window limit'
  }),
  bytes: () => ({
    name: 'stopped-at-size-limit',
    text: 'Stopped at the 256 MiB size limit'
  }),
  error: () => ({
    name: 'stopped-early',
    text: 'Stopped early, as a later part of the search couldn’t be read'
  })
}

const stopOf = ({ download }: ExploreAnswer) =>
  download?.stopped ? stops[download.stopped](download) : null

const toSearchedTo = (searchedTo: string | null | undefined): string =>
  searchedTo ? `: searched back to ${searchedTo}` : ''

const toStopLine = (answer: ExploreAnswer): string | null => {
  const stop = stopOf(answer)

  return (
    stop &&
    `# ${stop.text}${toSearchedTo(answer.download?.searchedTo)}. Run a narrower query for the rest.`
  )
}

/** Records the download passed over as too large to search, by their `_id`s. */
const toSkippedLine = ({ window }: ExploreAnswer): string | null => {
  const skipped = window?.skipped ?? []

  return skipped.length
    ? `# ${recordsOf(skipped.length)} too large to search, which may or may not match: ${skipped.map(({ id }) => toIdText(id)).join(', ')}`
    : null
}

/** A comment in the first column, so a spreadsheet shows it as a row of its own. */
const toCommentLines = (answer: ExploreAnswer): string[] =>
  [toSkippedLine(answer), toStopLine(answer)]
    .filter((line) => line !== null)
    .map((line) => toLine([toQuotedField(line)]))

/** The answer's columns and rows as CSV: a header line of the columns' labels, then a line a row, then what it skipped and where it stopped, if it did. */
export const toExploreCsv = (answer: ExploreAnswer): string =>
  [
    toLine(answer.columns.map(({ label }) => toQuotedField(toSafeText(label)))),
    ...answer.rows.map((row) =>
      toLine(answer.columns.map(({ key }) => toField(row.cells[key])))
    ),
    ...toCommentLines(answer)
  ].join('')

/** A CSV that stopped at a limit says which in its name. */
export const toCsvFilename = (answer: ExploreAnswer): string => {
  const stop = stopOf(answer)

  return `explore-${answer.source.name.replace(/[^a-z0-9-]/gi, '')}${stop ? `-${stop.name}` : ''}.csv`
}
