import type {
  ListPagination,
  ListTotal,
  Position
} from '../repositories/record-page.ts'
import type { ListResult } from '../use-cases/record-reads.ts'
import { toClock, toTimestamp, toValidDate } from './event-formats.ts'
import { toFields, toFilterHref } from './list-filters.ts'
import type { FilterField, FilterKeys } from './list-filters.ts'
import { toPositionLabel, toStatusLabel } from './position.ts'
import type { RecordType } from './record-type.ts'
import { toTimeRange } from './time-range.view-model.ts'
import type { TimeRange, TimeRangeList } from './time-range.view-model.ts'

/** The URL's part of a list; a searched ref is kept in the session instead. */
export interface RecordListQuery {
  code?: string
  from?: string
  to?: string
  range?: string
  cursor?: string
}

/** One row as both lists draw it. */
export interface RecordListEntry {
  href: string
  ref: string
  code: string
  position: Position
  createdAt: string | null
  replaced: boolean
  closedAt: string | null
}

export interface RecordListPage {
  entries: RecordListEntry[]
  pagination: ListPagination
  total?: ListTotal
  codes?: string[]
}

interface TimeCell {
  text: string
  instant: string
  precise: string
  clock: string
}

interface RecordListRow {
  href: string
  ref: string
  code: string
  replaced: boolean
  statusLabel: string | null
  positionLabel: string
  created: TimeCell
  closed: TimeCell | null
}

interface CodeChip {
  value: string | null
  label: string
  href: string
  active: boolean
}

interface CodeNote {
  code: string
  clearHref: string
}

export interface RecordListModel {
  list: RecordType
  rows: RecordListRow[]
  totalLabel: string | null
  codeFilters: CodeChip[]
  codeNote: CodeNote | null
  timeRange: TimeRange
  q: string | null
  searchFields: FilterField[]
  nextHref: string | null
  unavailable: boolean
  refused: boolean
}

const filterKeys: FilterKeys<RecordListQuery> = ['code', 'from', 'to', 'range']

/** Every filter the URL holds; the cursor is dropped, as a changed filter starts the list again. */
export const toListHref = (path: string, query: RecordListQuery): string =>
  toFilterHref(path, filterKeys, query)

const counted = new Intl.NumberFormat('en-GB')

/** "48 applications", or "10,000+ applications" past the count GAS stops at. */
export const toTotalLabel = (
  { count, capped }: ListTotal,
  { one, many }: RecordType['noun']
): string =>
  `${counted.format(count)}${capped ? '+' : ''} ${count === 1 && !capped ? one : many}`

const toClockOf = (date: Date | null, now: Date): string =>
  date === null ? '' : toClock(date, now)

const toTimeCell = (value: string | null, now: Date): TimeCell => ({
  ...toTimestamp(value, now),
  clock: toClockOf(value === null ? null : toValidDate(value), now)
})

const toRow =
  (list: RecordType, now: Date) =>
  (entry: RecordListEntry): RecordListRow => ({
    href: entry.href,
    ref: entry.ref,
    code: entry.code,
    replaced: entry.replaced,
    statusLabel: toStatusLabel(entry.position),
    positionLabel: toPositionLabel(entry.position),
    created: toTimeCell(entry.createdAt, now),
    closed:
      list.showClosed && entry.closedAt !== null
        ? toTimeCell(entry.closedAt, now)
        : null
  })

/** In order, whichever service listed them; a later page carries no codes, so the chosen one is kept all the same. */
const toCodes = (codes: string[], chosen: string | undefined): string[] =>
  (chosen === undefined || codes.includes(chosen)
    ? [...codes]
    : [...codes, chosen]
  ).sort((a, b) => a.localeCompare(b))

const toCodeChips = (
  { path }: RecordType,
  query: RecordListQuery,
  codes: string[] = []
): CodeChip[] => [
  {
    value: null,
    label: 'All',
    href: toListHref(path, { ...query, code: undefined }),
    active: !query.code
  },
  ...toCodes(codes, query.code).map((code) => ({
    value: code,
    label: code,
    href: toListHref(path, { ...query, code }),
    active: query.code === code
  }))
]

const toCodeNote = (
  { path }: RecordType,
  query: RecordListQuery
): CodeNote | null =>
  query.code
    ? {
        code: query.code,
        clearHref: toListHref(path, { ...query, code: undefined })
      }
    : null

const toNextHref = (
  { path }: RecordType,
  { hasNextPage, endCursor }: ListPagination,
  query: RecordListQuery
): string | null =>
  hasNextPage && endCursor
    ? toFilterHref(
        path,
        filterKeys,
        query,
        new URLSearchParams({ cursor: endCursor })
      )
    : null

/** No band over an empty or failed list, which says so itself. */
const toTotal = (
  { entries, total }: RecordListPage,
  noun: RecordType['noun']
): string | null =>
  entries.length === 0 || total === undefined ? null : toTotalLabel(total, noun)

const toTimeRangeList = (list: RecordType): TimeRangeList<RecordListQuery> => ({
  basePath: list.path,
  filterKeys,
  presetTitle: `${list.noun.many.charAt(0).toUpperCase()}${list.noun.many.slice(1)} created in the last`
})

export const toRecordList = (
  list: RecordType,
  { page, unavailable, refused }: ListResult<RecordListPage>,
  query: RecordListQuery,
  search: { q: string } | null,
  now: Date = new Date()
): RecordListModel => ({
  list,
  rows: page.entries.map(toRow(list, now)),
  totalLabel: toTotal(page, list.noun),
  codeFilters: toCodeChips(list, query, page.codes),
  codeNote: toCodeNote(list, query),
  timeRange: toTimeRange(toTimeRangeList(list), query, now),
  q: search === null ? null : search.q,
  // The search posts the ref; the URL's filters ride along to the list it returns to.
  searchFields: toFields(query, filterKeys),
  nextHref: toNextHref(list, page.pagination, query),
  unavailable,
  refused
})
