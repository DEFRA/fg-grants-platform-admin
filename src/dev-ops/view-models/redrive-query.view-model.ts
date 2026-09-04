import type {
  RedriveQueryResult,
  RedriveQuerySource
} from '../use-cases/redrive-query.use-case.ts'
import { toSourceName, toStatusLabel } from './event-formats.ts'

/**
 * The two pages a bulk redrive by query is made of: what is about to happen to
 * a set nobody can see all of, and what happened to it.
 *
 * The ticked-boxes batch could show its work — twenty rows, each named — and
 * the confirmation was the list of them. This flow cannot: the whole point of
 * it is that the set is seven thousand events long. So the confirmation shows
 * the *filters* instead, in the same words the toolbar that produced them uses,
 * and the count they add up to. An operator checks a query here, not a list.
 */

/** The filters both pages carry, exactly as the list spells them. */
export interface RedriveQueryFilters {
  status?: string
  service?: string
  q?: string
  error?: string
  from?: string
  to?: string
}

/** One line of the filter summary: what was narrowed, and to what. */
export interface FilterLine {
  label: string
  value: string
}

/** One filter as the confirmation's form carries it into the write. */
export interface FormField {
  name: string
  value: string
}

export interface RedriveQueryConfirmModel {
  /** Every filter that is actually set, in the toolbar's own order. */
  filters: FilterLine[]
  /**
   * Whether anything beyond the status narrows the write. `Status: Dead letter`
   * is on every one of these pages — it is what the endpoint does, not a choice
   * the operator made — so a confirmation showing it alone is a confirmation
   * for every dead letter there is, and that is worth saying in words rather
   * than leaving as the absence of other rows.
   */
  narrowed: boolean
  /** How many dead letters match, locale-grouped. Null when it could not be read. */
  countLabel: string | null
  count: number
  /** At most this many are processed per run — the backend's own cap. */
  limit: number
  limitLabel: string
  /** Where the confirmation posts, and the fields it has to carry with it. */
  action: string
  fields: FormField[]
  /** The list, filtered exactly as it was when the button was pressed. */
  backHref: string
}

/** One source's share of a write that spans four of them. */
export interface SourceRow {
  source: string
  matched: string
  processed: string
  redriven: string
  conflicts: string
  failures: string
}

export interface RedriveQueryResultsModel {
  /** The write could not be made at all — the page is an alert and a way back. */
  unavailable: boolean
  matched: number
  matchedLabel: string
  processed: number
  processedLabel: string
  redrivenLabel: string
  conflictsLabel: string
  failuresLabel: string
  perSource: SourceRow[]
  /**
   * More matched than one run could process, so there is more to do. It is the
   * one number on the page an operator has to act on, and asking them to
   * compare two figures to find it would be asking them to do the arithmetic
   * the page is for.
   */
  runAgain: boolean
  /** The confirmation again, with the same filters: one more run. */
  runAgainHref: string
  backHref: string
  /** `CW · Inbox` — sources that could not be read at all. Empty when none. */
  unavailableSources: string
}

/** Grouped, as every other figure this app prints is: `7,064`. */
const counted = new Intl.NumberFormat('en-GB')

const serviceNames: Record<string, string> = {
  gas: 'GAS',
  caseworking: 'Caseworking'
}

/**
 * The filters, said in the toolbar's own words rather than in the url's.
 *
 * `service=gas` is what travels; `Service: GAS` is what the operator chose, and
 * a confirmation that quoted the query string back at them would be asking them
 * to check a thing they never typed. Only the filters that are set are drawn: a
 * list of six rows, two of them saying `All`, would bury the ones that
 * actually narrow the write.
 */
const filterLines: {
  name: keyof RedriveQueryFilters
  label: string
  toValue?: (value: string) => string
}[] = [
  { name: 'status', label: 'Status', toValue: toStatusLabel },
  {
    name: 'service',
    label: 'Service',
    toValue: (value) => serviceNames[value] ?? value
  },
  { name: 'q', label: 'Search' },
  { name: 'error', label: 'Error' },
  { name: 'from', label: 'From' },
  { name: 'to', label: 'To' }
]

const toFilterLines = (filters: RedriveQueryFilters): FilterLine[] =>
  filterLines.flatMap(({ name, label, toValue }) => {
    const value = filters[name]

    return value ? [{ label, value: toValue ? toValue(value) : value }] : []
  })

/**
 * The same filters as form fields, so the POST that follows asks exactly the
 * question the count above the button was read under. `status` is not among
 * them: the endpoint redrives dead letters and nothing else, and sending it a
 * status it does not take would be inventing a parameter for the sake of
 * symmetry.
 */
const toFields = (filters: RedriveQueryFilters): FormField[] =>
  (['service', 'q', 'error', 'from', 'to'] as const).flatMap((name) => {
    const value = filters[name]

    return value ? [{ name, value }] : []
  })

/** The list as it was when the button was pressed, filters and all. */
export const toListHref = (filters: RedriveQueryFilters): string => {
  const params = new URLSearchParams()

  for (const [name, value] of Object.entries(filters)) {
    if (value) {
      params.set(name, value)
    }
  }

  return params.size ? `/dev-ops/events?${params}` : '/dev-ops/events'
}

const toConfirmHref = (filters: RedriveQueryFilters): string =>
  toListHref(filters).replace(
    '/dev-ops/events',
    '/dev-ops/events/redrive-query-confirm'
  )

export const toRedriveQueryConfirm = (
  filters: RedriveQueryFilters,
  count: number | null,
  limit: number
): RedriveQueryConfirmModel => ({
  filters: toFilterLines(filters),
  narrowed: toFields(filters).length > 0,
  count: count ?? 0,
  countLabel: count === null ? null : counted.format(count),
  limit,
  limitLabel: counted.format(limit),
  action: '/dev-ops/events/redrive-query',
  fields: toFields(filters),
  backHref: toListHref(filters)
})

/**
 * One figure of a per-source row. A source that reported nothing for a column
 * reported nothing, which is a zero: drawing a dash there would say the backend
 * declined to answer, and it did not.
 */
const toFigure = (value: number | undefined): string =>
  counted.format(value ?? 0)

const toSourceRow = (source: RedriveQuerySource): SourceRow => ({
  source: toSourceName(source),
  matched: toFigure(source.matched),
  processed: toFigure(source.processed),
  redriven: toFigure(source.redriven),
  conflicts: toFigure(source.conflicts),
  failures: toFigure(source.failures)
})

/** Nothing to report: the write could not be made, and nothing was written. */
const noResult: Omit<
  RedriveQueryResultsModel,
  'runAgainHref' | 'backHref' | 'unavailable'
> = {
  matched: 0,
  matchedLabel: '0',
  processed: 0,
  processedLabel: '0',
  redrivenLabel: '0',
  conflictsLabel: '0',
  failuresLabel: '0',
  perSource: [],
  runAgain: false,
  unavailableSources: ''
}

export const toRedriveQueryResults = (
  result: RedriveQueryResult | null,
  filters: RedriveQueryFilters
): RedriveQueryResultsModel => {
  const hrefs = {
    runAgainHref: toConfirmHref(filters),
    backHref: toListHref(filters)
  }

  if (result === null) {
    return { unavailable: true, ...noResult, ...hrefs }
  }

  return {
    unavailable: false,
    matched: result.matched,
    matchedLabel: counted.format(result.matched),
    processed: result.processed,
    processedLabel: counted.format(result.processed),
    redrivenLabel: counted.format(result.redriven),
    conflictsLabel: counted.format(result.conflicts),
    failuresLabel: counted.format(result.failures),
    perSource: (result.perSource ?? []).map(toSourceRow),
    // Offered only where there is something left to do. A `Run again` on a run
    // that reached everything it matched is a button that would queue the same
    // messages a second time.
    runAgain: result.processed < result.matched,
    ...hrefs,
    unavailableSources: (result.sourceErrors ?? []).map(toSourceName).join(', ')
  }
}
