import type {
  ExploreCell,
  ExploreColumn,
  ExploreObject,
  ExploreValue
} from '../use-cases/explore-calls.ts'
import { isIsoInstant } from './event-formats.ts'
import { toSize } from './record-raw-tab.ts'
import { toDayTime, toTime } from './times.ts'
import type { Times, TimeText } from './times.ts'

/** A value's text up to this many characters is drawn whole; longer, only its start. */
export const wholeMax = 1000

export const startMax = 300

/**
 * `text` is the value whole, or past `wholeMax` characters its first `startMax`
 * with `size` the whole value's.
 */
export type ExploreCellModel =
  | { kind: 'none' }
  | { kind: 'time'; time: TimeText }
  | {
      kind: 'text'
      text: string
      whole: boolean
      size: string | null
      mono: boolean
    }

/** Every digit a number has, its whole part grouped by thousands; one mongosh writes with an exponent, as it writes it. */
export const toNumberText = (value: number): string => {
  const text = String(value)

  return /^-?\d+(\.\d+)?$/.test(text)
    ? text.replace(/^(-?\d+)/, (whole) =>
        whole.replace(/\B(?=(\d{3})+$)/g, ',')
      )
    : text
}

export const recordsOf = (n: number): string =>
  `${toNumberText(n)} ${n === 1 ? 'record' : 'records'}`

const isoDay = /^\d{4}-\d{2}-\d{2}$/

const isIsoDay = (value: string): boolean =>
  isoDay.test(value) && isIsoInstant(`${value}T00:00:00Z`)

const isInstant = (value: string, column: ExploreColumn): boolean =>
  column.kind === 'date' && isIsoInstant(value)

/** A day, wherever it is, as a day; an instant in a date column as the person reads times. */
const toDate = (
  value: string,
  column: ExploreColumn,
  times: Times
): TimeText | null => {
  if (isIsoDay(value)) {
    return toDayTime(new Date(`${value}T00:00:00Z`), times)
  }

  return isInstant(value, column) ? toTime(new Date(value), times) : null
}

const toStringText = (
  value: string,
  column: ExploreColumn,
  times: Times
): string => toDate(value, column, times)?.text ?? value

const toValueText = (
  value: ExploreValue | null,
  column: ExploreColumn,
  times: Times
): string => {
  if (typeof value === 'number') {
    return toNumberText(value)
  }

  return value === null ? 'null' : toStringText(value, column, times)
}

const isObject = (value: ExploreCell | undefined): value is ExploreObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A list inside a list shows in brackets, as mongosh shows it. */
const toText = (
  value: ExploreCell,
  column: ExploreColumn,
  times: Times
): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => toText(item, column, times)).join(', ')}]`
  }

  return isObject(value) ? value.text : toValueText(value, column, times)
}

/** The first `n` characters, read no further than needed, so a value of megabytes costs no more than one of a thousand. */
const firstCharacters = (text: string, n: number): string[] => {
  const characters: string[] = []

  for (const character of text) {
    if (characters.length === n) {
      break
    }

    characters.push(character)
  }

  return characters
}

/** Counted in characters, so the start never splits one. */
const toTextCell = (text: string, mono: boolean): ExploreCellModel => {
  const whole = firstCharacters(text, wholeMax + 1).length <= wholeMax

  return {
    kind: 'text',
    text: whole ? text : firstCharacters(text, startMax).join(''),
    whole,
    size: whole ? null : toSize(Buffer.byteLength(text, 'utf8')),
    mono
  }
}

const toOneDate = (
  values: ExploreCell[],
  column: ExploreColumn,
  times: Times
): TimeText | null => {
  const [value] = values

  return values.length === 1 && typeof value === 'string'
    ? toDate(value, column, times)
    : null
}

const toTimeCell = (
  values: ExploreCell[],
  column: ExploreColumn,
  times: Times
): ExploreCellModel | null => {
  const date = toOneDate(values, column, times)

  return date ? { kind: 'time', time: date } : null
}

/** Every value of a list, objects inline in it. */
const toListCell = (
  values: ExploreCell[],
  column: ExploreColumn,
  times: Times,
  mono: boolean
): ExploreCellModel =>
  values.length
    ? toTextCell(
        values.map((value) => toText(value, column, times)).join(', '),
        mono
      )
    : { kind: 'none' }

/** An object alone, or a list of just one, shows as that object, in mono. */
const toValuesCell = (
  values: ExploreCell[],
  column: ExploreColumn,
  times: Times,
  mono: boolean
): ExploreCellModel => {
  const [only] = values

  if (values.length === 1 && isObject(only)) {
    return toTextCell(only.text, true)
  }

  return (
    toTimeCell(values, column, times) ?? toListCell(values, column, times, mono)
  )
}

const isEmptyList = (cell: ExploreCell | undefined): boolean =>
  Array.isArray(cell) && cell.length === 0

export const toCell = (
  cell: ExploreCell | undefined,
  column: ExploreColumn,
  times: Times,
  mono = false
): ExploreCellModel =>
  isEmptyList(cell)
    ? toTextCell('[]', mono)
    : toValuesCell([cell ?? []].flat(), column, times, mono)
