import type {
  ApplicationRow,
  ApplicationsResult,
  ListTotal
} from '../use-cases/search-applications.use-case.ts'
import { toClock, toTimestamp, toValidDate } from './event-formats.ts'
import { toFields, toFilterHref } from './list-filters.ts'
import type { FilterField, FilterKeys } from './list-filters.ts'
import { toPositionLabel, toStatusLabel } from './position.ts'
import { toTimeRange } from './time-range.view-model.ts'
import type { TimeRange, TimeRangeList } from './time-range.view-model.ts'

/** The URL's part of the list; a searched ref is kept in the session instead. */
export interface ApplicationsPageQuery {
  code?: string
  from?: string
  to?: string
  range?: string
  cursor?: string
}

interface ApplicationListRow {
  href: string
  clientRef: string
  code: string
  replaced: boolean
  statusLabel: string | null
  positionLabel: string
  createdAt: string
  createdAtInstant: string
  createdAtPrecise: string
  createdAtClock: string
}

interface GrantChip {
  value: string | null
  label: string
  href: string
  active: boolean
}

interface GrantNote {
  code: string
  clearHref: string
}

export interface ApplicationsPageModel {
  path: string
  rows: ApplicationListRow[]
  totalLabel: string | null
  grantFilters: GrantChip[]
  grantNote: GrantNote | null
  timeRange: TimeRange
  q: string | null
  searchFields: FilterField[]
  nextHref: string | null
  unavailable: boolean
  refused: boolean
}

export const applicationsPath = '/dev-ops/applications'

const filterKeys: FilterKeys<ApplicationsPageQuery> = [
  'code',
  'from',
  'to',
  'range'
]

const applicationsList: TimeRangeList<ApplicationsPageQuery> = {
  basePath: applicationsPath,
  filterKeys,
  presetTitlePrefix: 'Applications created in the last'
}

/** Every filter the URL holds; the cursor is dropped, as a changed filter starts the list again. */
export const toApplicationsHref = (query: ApplicationsPageQuery): string =>
  toFilterHref(applicationsPath, filterKeys, query)

export const toApplicationHref = ({
  code,
  clientRef
}: ApplicationRow['ref']): string =>
  `${applicationsPath}/${encodeURIComponent(code)}/${encodeURIComponent(clientRef)}`

const counted = new Intl.NumberFormat('en-GB')

/** "48 applications", or "10,000+ applications" past the count GAS stops at. */
export const toTotalLabel = ({ count, capped }: ListTotal): string =>
  `${counted.format(count)}${capped ? '+' : ''} ${count === 1 && !capped ? 'application' : 'applications'}`

const toClockOf = (value: string | null, now: Date): string => {
  const date = value === null ? null : toValidDate(value)

  return date === null ? '' : toClock(date, now)
}

const toRow =
  (now: Date) =>
  (row: ApplicationRow): ApplicationListRow => {
    const created = toTimestamp(row.createdAt, now)

    return {
      href: toApplicationHref(row.ref),
      clientRef: row.ref.clientRef,
      code: row.ref.code,
      replaced: row.replaced,
      statusLabel: toStatusLabel(row.position),
      positionLabel: toPositionLabel(row.position),
      createdAt: created.text,
      createdAtInstant: created.instant,
      createdAtPrecise: created.precise,
      createdAtClock: toClockOf(row.createdAt, now)
    }
  }

/** A later page carries no codes, so the chosen one is kept in the menu all the same. */
const toCodes = (codes: string[], chosen: string | undefined): string[] =>
  chosen === undefined || codes.includes(chosen) ? codes : [...codes, chosen]

const toGrantChips = (
  query: ApplicationsPageQuery,
  codes: string[] = []
): GrantChip[] => [
  {
    value: null,
    label: 'All',
    href: toApplicationsHref({ ...query, code: undefined }),
    active: !query.code
  },
  ...toCodes(codes, query.code).map((code) => ({
    value: code,
    label: code,
    href: toApplicationsHref({ ...query, code }),
    active: query.code === code
  }))
]

const toGrantNote = (query: ApplicationsPageQuery): GrantNote | null =>
  query.code
    ? {
        code: query.code,
        clearHref: toApplicationsHref({ ...query, code: undefined })
      }
    : null

const toNextHref = (
  { hasNextPage, endCursor }: ApplicationsResult['page']['pagination'],
  query: ApplicationsPageQuery
): string | null =>
  hasNextPage && endCursor
    ? toFilterHref(
        applicationsPath,
        filterKeys,
        query,
        new URLSearchParams({ cursor: endCursor })
      )
    : null

/** No band over an empty or failed list, which says so itself. */
const toTotal = ({ rows, total }: ApplicationsResult['page']): string | null =>
  rows.length === 0 || total === undefined ? null : toTotalLabel(total)

export const toApplicationsPage = (
  { page, unavailable, refused }: ApplicationsResult,
  query: ApplicationsPageQuery,
  search: { q: string } | null,
  now: Date = new Date()
): ApplicationsPageModel => ({
  path: applicationsPath,
  rows: page.rows.map(toRow(now)),
  totalLabel: toTotal(page),
  grantFilters: toGrantChips(query, page.codes),
  grantNote: toGrantNote(query),
  timeRange: toTimeRange(applicationsList, query, now),
  q: search?.q || null,
  searchFields: toFields(query, filterKeys),
  nextHref: toNextHref(page.pagination, query),
  unavailable,
  refused
})
