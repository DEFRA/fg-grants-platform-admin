import { statusCodes } from '../../common/status-codes.ts'
import { isUnanswered } from '../use-cases/gas-status.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type { ListTotal } from '../use-cases/record-reads.ts'
import type {
  BucketCell,
  BucketEntry,
  BucketFact,
  BucketFactValue,
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'
import { queueFact } from '../use-cases/list-bucket.use-case.ts'
import type {
  BucketListResult,
  StoppedPage
} from '../use-cases/list-bucket.use-case.ts'
import { toBucketHref, toRowHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { explorePath, toBucketPath } from './bucket-nav.ts'
import type { CaseworkingList } from './bucket-nav.ts'
import { toUrlQuery } from './bucket-urls.ts'
import {
  presentationOf,
  toChipOrder,
  toFactLabel,
  toListColumns,
  toTimeLabel,
  toTone,
  toVersionColumn
} from './catalogue-presentation.ts'
import type {
  ListColumn,
  NarrowColumn,
  Tone
} from './catalogue-presentation.ts'
import {
  errorKeyFact,
  errorKindLabel,
  errorParamOf,
  errorAtField,
  shownErrorField,
  toErrorKind,
  toErrorText
} from './error-search.ts'
import { isIsoInstant, shortId } from './event-formats.ts'
import { opensInExplore } from '../use-cases/explore-queries.ts'
import { toFailureText } from './failure-text.ts'
import { toFields } from './list-filters.ts'
import type { FilterField } from './list-filters.ts'
import { toPositionLabel } from './position.ts'
import { toServiceName } from './shell.ts'
import { toRangeChip } from './time-range.view-model.ts'
import type { TimeRangeQuery } from './time-range.view-model.ts'
import { toTime } from './times.ts'
import type { TimeText, Times } from './times.ts'
import { toVersionName } from './record-type.ts'

/** A search box that was refused: what was typed, handed back with the reason. */
export interface SearchAttempt {
  kind: string
  value: string
  error: string
}

/** Why the page shows a refusal, and what was refused. */
export type ListRefusal =
  /** The address names a filter the list doesn't declare: nothing was read. */
  | { kind: 'address' }
  /** The address's time range isn't dates, or ends before it starts: nothing was read. */
  | { kind: 'range' }
  /** The service refused the search, which is cleared: the rows are the list without it. */
  | { kind: 'search'; message: string | null }

export interface ListPageInput {
  bucket: BucketEntry
  /** Null when nothing was read: the address named a filter the list doesn't declare. */
  read: BucketListResult | null
  filters: BucketFilters
  times: Times
  /** The search the page ran, and the id its later pages name it by; none for a browse. */
  search: { q: string; id: string } | null
  /** A later page, loaded from this cursor. */
  cursor?: string
  /** Where the page drawn first falls in the list: 1 for the first page, or a later page's number. */
  page?: number
  /** Every page through this one is drawn, by an address that restores them. */
  through?: number
  /** Rows on each page drawn, when more than one was read. */
  pageRows?: number[]
  /** A later page of those that couldn't be read. */
  stopped?: StoppedPage | null
  /** The queue whose read failed the page, of a list over several. */
  failedQueue?: string | null
  /** The address came from a later page of a search no longer held. */
  notice?: ListNotice
  attempt?: SearchAttempt
  refusal?: ListRefusal
  now?: Date
}

/** The search held expired, or the list changed under the cursor of the page asked for. */
export type ListNotice = 'expired' | 'changed'

interface ChipItem {
  text: string
  value: string
  checked: boolean
}

/** A chip's ticks are applied at once, by a form that carries the list's other filters. */
interface FilterChipModel {
  fact: string
  label: string
  /** The one value chosen, "2 selected", or All. */
  value: string
  /** The field the ticks are sent under, as the list's URL spells the fact. */
  name: string
  items: ChipItem[]
  action: string
  keep: FilterField[]
  clearHref: string
}

interface SearchKind {
  text: string
  value: string
  checked: boolean
}

interface SearchModel {
  action: string
  value: string
  error: string | null
  noun: string
  hidden: FilterField[]
  kinds: SearchKind[]
}

/** A removable tag: one value of a filter whose chip reads a count, or that has no control. */
export interface Applied {
  key: string
  label: string
  value: string
  mono: boolean
  removeHref: string
}

interface RangeModel {
  label: string
  text: string
  isSet: boolean
  start: string | undefined
  end: string | undefined
  presets: { text: string; href: string; checked: boolean }[]
  action: string
  hidden: FilterField[]
  max: string
}

interface HiddenForm {
  id: string
  action: string
  hidden: FilterField[]
}

export type Cell =
  | {
      kind: 'link'
      text: string
      href: string
      mono: boolean
      /** The row's subtitle, under the title, where no column of its own draws it. */
      subtitle: string | null
    }
  | { kind: 'text'; text: string; mono: boolean }
  /** A long id by its ends, the whole for its title and for screen readers. */
  | { kind: 'short'; text: string; full: string }
  | { kind: 'status'; text: string; tone: Tone; hint: string | null }
  | { kind: 'time'; time: TimeText }
  | { kind: 'none' }

interface RowModel {
  /** The row's place in the list, which Back from its page lands on. */
  id: string
  /** Past the most an address draws, the row's page by its cursor; else the loader's address through every page shown. */
  restoreHref: string | null
  href: string | null
  cells: AlignedCell[]
  /** On a phone, in place of the cells: each a cell, with others under it. */
  narrowCells: { main: AlignedCell; under: Cell[]; align: 'start' | 'right' }[]
}

type AlignedCell = Cell & { align: 'start' | 'right' }

type FooterState =
  | { state: 'more'; nextHref: string; noun: string }
  | {
      state: 'searched'
      searchedTo: TimeText
      keepLookingHref: string
      noun: string
    }
  | { state: 'end'; text: string | null; noun: string }
  | { state: 'error'; text: string; retryHref: string; noun: string }

/** Each carries the address of every row shown so far, for the address bar once more are loaded. */
export type Footer = FooterState & { restoreHref: string }

interface EmptyModel {
  title: string
  text: string
  icon: string
}

interface TableModel {
  label: string
  columns: Pick<ListColumn, 'key' | 'label' | 'width' | 'mono' | 'align'>[]
  rows: RowModel[]
  empty: EmptyModel | null
  footer: Footer | null
  narrowColumns: Pick<NarrowColumn, 'label' | 'width' | 'align'>[] | null
}

export interface ListAlert {
  tone: 'info' | 'warning' | 'danger'
  title: string
  /** Shown in code, before the text: the service's own words. */
  code: string | null
  text: string
  retryHref: string | null
  startHref: string | null
  links: { text: string; href: string }[]
}

export interface ListPageModel {
  pageTitle: string
  navActive: string
  title: string
  meta: string[]
  filterLabel: string
  chips: FilterChipModel[]
  /** Null where no filters can be drawn. */
  range: RangeModel | null
  searchField: SearchModel | null
  /** One tag per value of a chip that reads a count, or of a filter with no control, each removing it. */
  applied: Applied[]
  /** Only while a tag is shown: Clear all goes with the tags. */
  filtered: boolean
  /** How many records the filters find, "12,481 events"; null where the read was bounded or the list couldn't be read. */
  total: string | null
  clearAllHref: string
  /** The form Open in Explore sends; null for a list Explore doesn't open. */
  exploreForm: HiddenForm | null
  alert: ListAlert | null
  table: TableModel | null
}

interface Context {
  bucket: BucketEntry
  filters: BucketFilters
  result: BucketResult | null
  times: Times
  now: Date
  searched: Searched | null
  searchId: string | null
  /** The cursor the page drawn was read from; none for the first page or a restore. */
  cursor: string | null
  /** The number of the first page drawn. */
  page: number
  /** Rows on each page drawn. */
  pageRows: number[]
}

interface Searched {
  kind: string
  value: string
}

const exploreFormId = 'list-explore'

/** The address Clear all goes to while a search is held: it drops the search too. */
export const clearParam = 'clear'

/** The first page, opened in place of a later page of a search no longer held. */
export const expiredParam = 'expired'

/** The first page, opened in place of a later page whose cursor no longer reads. */
export const changedParam = 'changed'

const counted = new Intl.NumberFormat('en-GB')

const totalText = ({ count, capped }: ListTotal, noun: BucketEntry['noun']) =>
  `${counted.format(count)}${capped ? '+' : ''} ${count === 1 ? noun.one : noun.many}`

const toTotal = ({ bucket, result }: Context): string | null =>
  result?.total ? totalText(result.total, bucket.noun) : null

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** "Reference" reads "reference" in a sentence; "Event ID" and "SBI" keep their capitals. */
const inSentence = (label: string): string =>
  /^[A-Z][a-z]/.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : label

/** The values a fact is filtered by: none, one, or several. */
const chosenOf = ({ filters }: Context, fact: string): string[] =>
  [filters[fact] ?? []].flat()

/** A fact's values mean nothing under another choice of the fact they are within, so that choice drops them. */
const withoutFact = (
  { bucket, filters }: Context,
  fact: string
): BucketFilters => {
  const dropped = new Set([
    fact,
    ...bucket.facts
      .filter(({ within }) => within === fact)
      .map(({ name }) => name)
  ])

  return Object.fromEntries(
    Object.entries(filters).filter(([key]) => !dropped.has(key))
  )
}

const hrefWith = (
  context: Context,
  fact: string,
  values: string[] | undefined
): string =>
  toBucketHref(context.bucket, {
    ...withoutFact(context, fact),
    [fact]: values?.length ? values : undefined
  })

const hasValues = (
  fact: BucketFact
): fact is BucketFact & { values: BucketFactValue[] } => fact.values !== null

/** The catalogue's values, those the list names last moved to the end. */
const inListOrder = (
  bucket: BucketEntry,
  fact: BucketFact & { values: BucketFactValue[] }
): BucketFactValue[] => {
  const last = presentationOf(bucket).lastValues?.[fact.name] ?? []
  const isLast = (option: BucketFactValue) =>
    last.includes(String(option.value))

  return [
    ...fact.values.filter((option) => !isLast(option)),
    ...fact.values.filter(isLast)
  ]
}

/** A chosen value the menu lacks (a code with no rows yet) is kept in it all the same. */
const withChosen = (
  bucket: BucketEntry,
  fact: BucketFact & { values: BucketFactValue[] },
  chosen: string[]
): BucketFactValue[] => [
  ...inListOrder(bucket, fact),
  ...chosen
    .filter(
      (value) => !fact.values.some((option) => String(option.value) === value)
    )
    .map((value) => ({ value, label: value }))
]

const labelOf = (fact: BucketFact, value: string): string =>
  fact.values?.find((option) => String(option.value) === value)?.label ?? value

/** The chosen values in the order the chip's menu lists them. */
const inMenuOrder = (
  bucket: BucketEntry,
  fact: BucketFact,
  chosen: string[]
): string[] =>
  hasValues(fact)
    ? withChosen(bucket, fact, chosen)
        .map((option) => String(option.value))
        .filter((value) => chosen.includes(value))
    : chosen

/** A chip with more than one value ticked reads their count, and its values show as tags. */
const readsCount = (chosen: string[]): boolean => chosen.length > 1

const chipText = (fact: BucketFact, chosen: string[]): string => {
  if (readsCount(chosen)) {
    return `${chosen.length} selected`
  }

  return chosen.length ? labelOf(fact, chosen[0]) : 'All'
}

/** Apply sends the list's other filters with the boxes ticked, so a new choice drops the facts within it as Clear does. */
const toChip =
  (context: Context) =>
  (fact: BucketFact & { values: BucketFactValue[] }): FilterChipModel => {
    const { bucket } = context
    const chosen = chosenOf(context, fact.name)

    return {
      fact: fact.name,
      label: toFactLabel(bucket, fact),
      value: chipText(fact, chosen),
      name: fact.param,
      items: withChosen(bucket, fact, chosen).map((option) => ({
        text: option.label,
        value: String(option.value),
        checked: chosen.includes(String(option.value))
      })),
      action: toBucketPath(bucket),
      keep: toUrlFields(bucket, withoutFact(context, fact.name)),
      clearHref: hrefWith(context, fact.name, undefined)
    }
  }

/** The filters a form carries with it, under the keys the list's URL spells them by. */
const toUrlFields = (
  bucket: BucketEntry,
  filters: BucketFilters
): FilterField[] => {
  const query = toUrlQuery(bucket, filters)

  return toFields(query, Object.keys(query))
}

const rangeKeys = ['from', 'to', 'range']

const withoutRange = (filters: BucketFilters): BucketFilters =>
  Object.fromEntries(
    Object.entries(filters).filter(([key]) => !rangeKeys.includes(key))
  )

const toRange = (context: Context): RangeModel => {
  const { bucket, filters, now, times } = context
  const chip = toRangeChip(
    filters as TimeRangeQuery,
    (window) => toBucketHref(bucket, { ...withoutRange(filters), ...window }),
    now,
    times.zone
  )

  return {
    label: toTimeLabel(bucket),
    ...chip,
    action: toBucketPath(bucket),
    hidden: toUrlFields(bucket, withoutRange(filters)),
    max: chip.max
  }
}

/** A stored search is one `kind:value`; the value may hold colons of its own. */
const toSearched = (q: string): Searched | null => {
  const [kind, ...value] = q.split(':')

  return value.length === 0 ? null : { kind, value: value.join(':') }
}

/** The kinds the field searches by: the list's identifiers, then the error where the list has the fact. */
const toKinds = (bucket: BucketEntry) => {
  const param = errorParamOf(bucket)

  return [
    ...bucket.refs,
    ...(param === null
      ? []
      : [{ kind: toErrorKind(param), label: errorKindLabel }])
  ]
}

/** The error in the address is the field's search, shown as the message; else the search the session holds. */
const toShownSearch = (context: Context): Searched | null => {
  const [errorKey] = chosenOf(context, errorKeyFact)
  const param = errorParamOf(context.bucket)

  return errorKey && param !== null
    ? { kind: toErrorKind(param), value: toErrorText(errorKey) }
    : context.searched
}

/** The error is the field's to set, so the field doesn't carry the one in the address. */
const withoutError = (filters: BucketFilters): BucketFilters =>
  Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== errorKeyFact)
  )

/** The key the list takes the error under, and the key the field shows the error of, so its text sent unchanged searches that key again. */
const toErrorFields = (context: Context): FilterField[] => {
  const param = errorParamOf(context.bucket)
  const [errorKey] = chosenOf(context, errorKeyFact)

  if (param === null) {
    return []
  }

  return [
    { name: errorAtField, value: param },
    ...(errorKey ? [{ name: shownErrorField, value: errorKey }] : [])
  ]
}

const toSearchField = (
  context: Context,
  attempt?: SearchAttempt
): SearchModel | null => {
  const { bucket, filters } = context
  const kinds = toKinds(bucket)
  const shown = {
    kind: '',
    value: '',
    error: null,
    ...toShownSearch(context),
    ...attempt
  }

  return bucket.refs.length === 0
    ? null
    : {
        action: toBucketPath(bucket),
        value: shown.value,
        error: shown.error,
        noun: bucket.noun.many,
        hidden: [
          ...toUrlFields(bucket, withoutError(filters)),
          ...toErrorFields(context)
        ],
        kinds: kinds.map(({ kind, label }, index) => ({
          text: label,
          value: kind,
          checked: shown.kind ? kind === shown.kind : index === 0
        }))
      }
}

const kindLabel = (bucket: BucketEntry, kind: string): string | null =>
  toKinds(bucket).find((ref) => ref.kind === kind)?.label ?? null

/** A filter with no control of its own, as a version page's link sets: only its tag shows it. */
const hasNoControl = (fact: BucketFact): boolean =>
  !hasValues(fact) && fact.name !== errorKeyFact

/**
 * One tag per value of a chip that reads "2 selected", and for a filter with
 * no control: a single choice, and the search, show their own.
 */
const toApplied = (context: Context): Applied[] => {
  const { bucket } = context
  const tagsOf = (fact: BucketFact) => {
    const chosen = chosenOf(context, fact.name)

    return hasValues(fact) && !readsCount(chosen)
      ? []
      : inMenuOrder(bucket, fact, chosen).map((value) => ({
          key: fact.name,
          label: toFactLabel(bucket, fact),
          value: labelOf(fact, value),
          mono: !hasValues(fact),
          removeHref: hrefWith(
            context,
            fact.name,
            chosen.filter((one) => one !== value)
          )
        }))
  }

  return [
    ...toChipOrder(bucket, bucket.facts.filter(hasValues)).flatMap(tagsOf),
    ...bucket.facts.filter(hasNoControl).flatMap(tagsOf)
  ]
}

/** What is set, by name, for the empty table's words: the time, any fact, and the search. */
const toSetNames = (context: Context, range: RangeModel): string[] => [
  ...(range.isSet ? ['time'] : []),
  ...context.bucket.facts
    .filter(
      ({ name }) => name !== errorKeyFact && chosenOf(context, name).length
    )
    .map(({ name }) => name),
  ...(toShownSearch(context) ? ['search'] : [])
]

const toTimeOrText = (value: string, times: Times): Cell =>
  isIsoInstant(value)
    ? { kind: 'time', time: toTime(new Date(value), times) }
    : { kind: 'text', text: value, mono: false }

type CellValue = NonNullable<BucketCell>

const factOf = ({ bucket }: Context, column: ListColumn) =>
  bucket.facts.find(({ name }) => name === column.fact)

const valueOf = (
  context: Context,
  column: ListColumn,
  value: CellValue
): BucketFactValue =>
  factOf(context, column)?.values?.find(
    (option) => String(option.value) === String(value)
  ) ?? { value: String(value), label: String(value) }

const hintOf = (column: ListColumn, option: BucketFactValue): string | null =>
  column.tooltip ? (option.hint ?? null) : null

const toStatus = (
  context: Context,
  column: ListColumn,
  value: CellValue
): Cell => {
  const option = valueOf(context, column, value)

  return {
    kind: 'status',
    text: option.label,
    tone: toTone(
      context.bucket,
      String(column.fact),
      option.value,
      option.tone
    ),
    hint: hintOf(column, option)
  }
}

const toCellText = (value: CellValue): string =>
  typeof value === 'object' ? toPositionLabel(value) : String(value)

const toPositionText = (value: CellValue): Cell => ({
  kind: 'text',
  text: toCellText(value),
  mono: false
})

type Draw = (context: Context, column: ListColumn, value: CellValue) => Cell

/** A format this page has not heard of is drawn as text, so a new one never breaks a list. */
const draws: Record<string, Draw> = {
  badge: toStatus,
  label: (context, column, value) => ({
    kind: 'text',
    text: valueOf(context, column, value).label,
    mono: false
  }),
  short: (_context, _column, value) => ({
    kind: 'short',
    text: shortId(toCellText(value)),
    full: toCellText(value)
  }),
  time: (context, _column, value) => toTimeOrText(String(value), context.times),
  position: (_context, _column, value) => toPositionText(value)
}

const asText: Draw = (_context, column, value) => ({
  kind: 'text',
  text: String(value),
  mono: column.mono
})

const isEmpty = (
  value: BucketCell | undefined
): value is null | undefined | '' =>
  value === null || value === undefined || value === ''

const toCatalogueCell = (
  context: Context,
  column: ListColumn,
  value: BucketCell | undefined
): Cell =>
  isEmpty(value)
    ? { kind: 'none' }
    : (draws[column.format] ?? asText)(context, column, value)

const versionOf = ({ bucket }: Context, row: BucketRow): string | null => {
  const column = toVersionColumn(bucket)
  const version = column && row.cells[column]

  return typeof version === 'string' && version !== '' ? version : null
}

/** `woodland@1.4.2`, or the code alone for a row with no version. */
const toTitle = (context: Context, row: BucketRow): string | null => {
  const version = versionOf(context, row)

  return row.title !== null && version
    ? toVersionName({ code: row.title, version })
    : row.title
}

/** A subtitle the catalogue sends for a list GPA gives no subtitle column is drawn under the title, so none is lost. */
const subtitleUnder = ({ bucket }: Context, row: BucketRow): string | null =>
  presentationOf(bucket).subtitle ? null : row.subtitle

const toTitleCell = (
  context: Context,
  column: ListColumn,
  row: BucketRow,
  href: string | null
): Cell => {
  const text = toTitle(context, row)

  if (text === null) {
    return { kind: 'none' }
  }

  return href === null
    ? { kind: 'text', text, mono: column.mono }
    : {
        kind: 'link',
        text,
        href,
        mono: column.mono,
        subtitle: subtitleUnder(context, row)
      }
}

type CellOf = (
  context: Context,
  column: ListColumn,
  row: BucketRow,
  href: string | null
) => Cell

const cells: Record<ListColumn['kind'], CellOf> = {
  title: toTitleCell,
  subtitle: (context, column, row) =>
    toCatalogueCell(
      context,
      { ...column, format: column.format === 'short' ? 'short' : 'text' },
      row.subtitle
    ),
  time: (context, _column, row) => toTimeOrText(row.time, context.times),
  cell: (context, column, row) =>
    toCatalogueCell(context, column, row.cells[column.key])
}

/** Where a row falls: its page, and its place on that page, from 1. */
interface RowPlace {
  page: number
  index: number
}

const toRowId = ({ page, index }: RowPlace): string => `row-${page}-${index}`

const cellAt = (
  columns: ListColumn[],
  drawn: AlignedCell[],
  key: string
): AlignedCell => {
  const at = columns.findIndex((column) => column.key === key)

  return at < 0 ? { kind: 'none', align: 'start' } : drawn[at]
}

const toNarrowCells = (
  context: Context,
  columns: ListColumn[],
  drawn: AlignedCell[]
): RowModel['narrowCells'] =>
  (presentationOf(context.bucket).narrowColumns ?? []).map(
    ({ main, under, align }) => ({
      main: cellAt(columns, drawn, main),
      under: under
        .map((key) => cellAt(columns, drawn, key))
        .filter(({ kind }) => kind !== 'none'),
      align
    })
  )

const toRow =
  (context: Context, columns: ListColumn[]) =>
  (row: BucketRow, place: RowPlace): RowModel => {
    const id = toRowId(place)
    const href = toRowHref(
      row.link,
      `${toPlaceHref(context, place.page)}#${id}`
    )
    const drawn = columns.map((column) => ({
      ...cells[column.kind](context, column, row, href),
      align: column.align
    }))

    return {
      id,
      restoreHref: toRowRestore(context, place.page),
      href,
      cells: drawn,
      narrowCells: toNarrowCells(context, columns, drawn)
    }
  }

/** A later page of a search names it, so it is read with the search its first page ran and no other; and its number, so its rows know their place. */
const toCursorHref = (
  { bucket, filters, searchId }: Context,
  cursor: string,
  page: number
): string =>
  toBucketHref(
    bucket,
    filters,
    new URLSearchParams({
      cursor,
      ...(searchId ? { searched: searchId } : {}),
      page: String(page)
    })
  )

/** The most pages an address draws at once. */
export const restoreMax = 50

/** Every page from the first through this one: positions and the search's id only, never what was searched for. */
const toRestoreHref = (
  { bucket, filters, searchId }: Context,
  through: number
): string =>
  toBucketHref(
    bucket,
    filters,
    new URLSearchParams({
      ...(searchId ? { searched: searchId } : {}),
      through: String(Math.min(through, restoreMax))
    })
  )

/** Every page through this one, or past the most an address draws, the page drawn by its own cursor. */
const toPlaceHref = (context: Context, through: number): string =>
  context.cursor && through > restoreMax
    ? toCursorHref(context, context.cursor, context.page)
    : toRestoreHref(context, through)

/** Past the most an address draws, the row's page by its cursor; null within it, so the address keeps every page loaded. */
const toRowRestore = (context: Context, page: number): string | null =>
  context.cursor && page > restoreMax
    ? toCursorHref(context, context.cursor, context.page)
    : null

const lastPageOf = ({ page, pageRows }: Context): number =>
  page + Math.max(pageRows.length, 1) - 1

/** Only a bounded read can have looked at less than everything, so only it says when it has. */
const searchedEverything = ({ plan, page }: BucketResult): boolean =>
  plan.kind !== 'exact' && page.complete

/** Where a bounded read stopped, and the way on from there. */
const toKeepLooking = (
  context: Context,
  { keepLooking, searchedTo }: BucketResult['page']
): FooterState | null =>
  keepLooking && searchedTo && isIsoInstant(searchedTo)
    ? {
        state: 'searched',
        searchedTo: toTime(new Date(searchedTo), context.times),
        keepLookingHref: toCursorHref(
          context,
          keepLooking,
          lastPageOf(context) + 1
        ),
        noun: context.bucket.noun.many
      }
    : null

/** A bounded read says it reached the end; a later page that did, so the loaded rows' address can be kept. */
const toEnd = (context: Context, result: BucketResult): FooterState | null => {
  if (searchedEverything(result)) {
    return {
      state: 'end',
      text: 'Searched everything.',
      noun: context.bucket.noun.many
    }
  }

  return lastPageOf(context) > 1
    ? { state: 'end', text: null, noun: context.bucket.noun.many }
    : null
}

/** A next page first, as it carries its own footer; else where a search stopped, or that it reached the end. */
const toFooterState = (
  context: Context,
  result: BucketResult
): FooterState | null => {
  const { next } = result.page

  return next
    ? {
        state: 'more',
        nextHref: toCursorHref(context, next, lastPageOf(context) + 1),
        noun: context.bucket.noun.many
      }
    : (toKeepLooking(context, result.page) ?? toEnd(context, result))
}

const withRestore = (
  context: Context,
  footer: FooterState | null
): Footer | null =>
  footer && {
    ...footer,
    restoreHref: toPlaceHref(context, lastPageOf(context))
  }

const soFar: EmptyModel = {
  title: 'No matches so far',
  text: 'Keep looking to search further back.',
  icon: 'search'
}

/** Nothing on: what would be here, and how it gets here. */
const toNothingYet = ({ bucket }: Context): EmptyModel => ({
  title: `No ${bucket.noun.many} yet`,
  text:
    presentationOf(bucket).emptyText?.(bucket.service) ??
    `${capitalise(bucket.noun.many)} ${bucket.service} keeps appear here.`,
  icon: 'inbox'
})

const isOnlySearch = (set: string[]): boolean =>
  set.length === 1 && set[0] === 'search'

/** A search on: it names what had no match, under any filters beside it. */
const searchMiss = (context: Context, set: string[]): string | null => {
  const { bucket } = context
  const searched = toShownSearch(context)
  const label = searched && kindLabel(bucket, searched.kind)
  const which = isOnlySearch(set) ? '' : ' with these filters'

  return (
    label && `No ${bucket.noun.many}${which} have this ${inSentence(label)}.`
  )
}

const toNoMatch = (context: Context, set: string[]): EmptyModel => ({
  title: `No ${context.bucket.noun.many} match`,
  text:
    searchMiss(context, set) ??
    presentationOf(context.bucket).noMatchText ??
    'Nothing matches these filters.',
  icon: 'search'
})

const toEmpty = (
  context: Context,
  set: string[],
  footer: FooterState | null
): EmptyModel => {
  if (footer?.state === 'searched') {
    return soFar
  }

  return set.length ? toNoMatch(context, set) : toNothingYet(context)
}

const toAddressRefusal = (startHref: string): ListAlert => ({
  tone: 'warning',
  title: 'This address has a filter the list doesn’t have.',
  code: null,
  text: 'Nothing was read. Start again to see the list.',
  retryHref: null,
  startHref,
  links: []
})

const toRangeRefusal = (startHref: string): ListAlert => ({
  tone: 'warning',
  title: 'This address has a time range the list can’t read.',
  code: null,
  text: 'Its start and end must be dates, the start no later than the end. Nothing was read. Start again to see the list.',
  retryHref: null,
  startHref,
  links: []
})

const toSearchRefusal = (
  bucket: BucketEntry,
  message: string | null,
  startHref: string
): ListAlert => ({
  tone: 'warning',
  title: `${bucket.service} refused this search.`,
  code: message,
  text: 'The search has been cleared.',
  retryHref: null,
  startHref,
  links: []
})

const toFilterRefusal = (
  bucket: BucketEntry,
  message: string | null,
  startHref: string
): ListAlert => ({
  tone: 'warning',
  title: `${bucket.service} refused these filters.`,
  code: message,
  text: 'Start again to clear them.',
  retryHref: null,
  startHref,
  links: []
})

/** GAS's own error is worth looking up in its logs. */
const toUnavailableText = (failure: GasFailure, service: string): string => {
  const text = `${toFailureText(failure, service)} Nothing has changed — try again in a moment`

  return failure.kind === 'errored' || failure.kind === 'refused'
    ? `${text}; if it keeps failing, check GAS’s logs.`
    : `${text}.`
}

/** One queue of a list over several, by its value. */
interface Queue {
  fact: BucketFact
  value: string
}

/** The queue an answer names, of a list over several; null for a list of one, or none named. */
const queueOf = (
  { bucket }: Context,
  value: string | null | undefined
): Queue | null => {
  const fact = bucket.facts.find(({ name }) => name === queueFact)

  return fact && value ? { fact, value } : null
}

/** "the Outbox", as a sentence names a queue. */
const queueName = ({ fact, value }: Queue): string =>
  `the ${labelOf(fact, value)}`

/** The queues but one the page could show alone: those picked, or every one when none is. */
const otherQueues = (
  context: Context,
  { fact, value: but }: Queue
): Queue[] => {
  const picked = chosenOf(context, fact.name)
  const isShown = (value: string) =>
    picked.length === 0 || picked.includes(value)

  return (fact.values ?? [])
    .map(({ value }) => String(value))
    .filter((value) => value !== but && isShown(value))
    .map((value) => ({ fact, value }))
}

const toShowOnly = (context: Context, queues: Queue[]) =>
  queues.map((queue) => ({
    text: `Show ${queueName(queue)} only`,
    href: toBucketHref(context.bucket, {
      ...context.filters,
      [queue.fact.name]: [queue.value]
    })
  }))

/** What a list that couldn't be read says, naming the service it is down to; nothing has changed. */
const toUnavailableAlert = (
  bucket: BucketEntry,
  failure: GasFailure,
  retryHref: string
): ListAlert => ({
  tone: 'danger',
  title: `The ${bucket.noun.many} list couldn’t be loaded.`,
  code: null,
  text: toUnavailableText(failure, bucket.service),
  retryHref,
  startHref: null,
  links: []
})

/** One queue failed: rows from the others alone would show out of order, so the page offers to show them alone. */
const toQueueFailedAlert = (
  context: Context,
  failure: GasFailure,
  retryHref: string,
  queue: string | null | undefined
): ListAlert => {
  const alert = toUnavailableAlert(context.bucket, failure, retryHref)
  const failed = queueOf(context, queue)
  const others = failed ? otherQueues(context, failed) : []

  return failed && others.length
    ? {
        ...alert,
        text: `${alert.text} ${capitalise(queueName(failed))} couldn’t be read, and both queues are needed to show ${context.bucket.noun.many} in order.`,
        links: toShowOnly(context, others)
      }
    : alert
}

/** Searches are held for a while only: a later page of one gone opens the first page, saying why. */
const expiredNotice: ListAlert = {
  tone: 'info',
  title: 'This search has expired.',
  code: null,
  text: 'Search again to see its results.',
  retryHref: null,
  startHref: null,
  links: []
}

/** A cursor the service can no longer read: the first page instead, saying why. */
const toChangedNotice = (bucket: BucketEntry): ListAlert => ({
  tone: 'info',
  title: 'This list changed since the page was loaded.',
  code: null,
  text: `Showing the newest ${bucket.noun.many}.`,
  retryHref: null,
  startHref: null,
  links: []
})

const noQueues: NonNullable<BucketResult['queues']> = {
  limited: [],
  waiting: []
}

interface Limit {
  limited: Queue
  waiting: Queue
  searchedTo: string
}

type MaybeLimit = { [K in keyof Limit]: Limit[K] | null }

const isLimit = (limit: MaybeLimit): limit is Limit =>
  Boolean(limit.limited && limit.waiting && limit.searchedTo)

const limitOf = (context: Context, result: BucketResult): MaybeLimit => {
  const queues = result.queues ?? noQueues

  return {
    limited: queueOf(context, queues.limited[0]),
    waiting: queueOf(context, queues.waiting[0]),
    searchedTo: result.page.searchedTo
  }
}

/** A queue searched a window at a time ended the page while another has older rows waiting, which show only once it gets that far. */
const toLimitedAlert = (
  context: Context,
  { limited, waiting, searchedTo }: Limit
): ListAlert => ({
  tone: 'info',
  title: `${capitalise(queueName(limited))} is searched a window at a time.`,
  code: null,
  text: `${labelOf(waiting.fact, waiting.value)} ${context.bucket.noun.many} older than ${toTime(new Date(searchedTo), context.times).text} show once ${queueName(limited)} has been searched that far back.`,
  retryHref: null,
  startHref: null,
  links: toShowOnly(
    context,
    otherQueues(context, limited).filter(({ value }) => value === waiting.value)
  )
})

const toQueueLimited = (context: Context): ListAlert | null => {
  const limit = context.result && limitOf(context, context.result)

  return limit && isLimit(limit) ? toLimitedAlert(context, limit) : null
}

type AlertRule = (
  input: ListPageInput,
  context: Context,
  startHref: string,
  retryHref: string
) => ListAlert | null

/** The first that applies is the page's alert; a later page's failure is said in its footer instead. */
const alertRules: AlertRule[] = [
  ({ refusal }, _context, start) =>
    refusal?.kind === 'address' ? toAddressRefusal(start) : null,
  ({ refusal }, _context, start) =>
    refusal?.kind === 'range' ? toRangeRefusal(start) : null,
  ({ bucket, refusal }, _context, start) =>
    refusal?.kind === 'search'
      ? toSearchRefusal(bucket, refusal.message, start)
      : null,
  ({ bucket, read }, _context, start) =>
    read?.kind === 'refused'
      ? toFilterRefusal(bucket, read.refusal, start)
      : null,
  ({ read, cursor, failedQueue }, context, _start, retry) =>
    read?.kind === 'failed' && !cursor
      ? toQueueFailedAlert(context, read.failure, retry, failedQueue)
      : null,
  ({ notice }) => (notice === 'expired' ? expiredNotice : null),
  ({ bucket, notice }) =>
    notice === 'changed' ? toChangedNotice(bucket) : null,
  (_input, context) => toQueueLimited(context)
]

const toAlert = (
  input: ListPageInput,
  context: Context,
  retryHref: string
): ListAlert | null =>
  alertRules
    .map((rule) => rule(input, context, toBucketPath(input.bucket), retryHref))
    .find((alert) => alert !== null) ?? null

/** The queue that failed a later page, of a list over several, said after why. */
const failedQueueText = (
  context: Context,
  queue: string | null | undefined
): string => {
  const failed = queueOf(context, queue)

  return failed ? ` ${capitalise(queueName(failed))} couldn’t be read.` : ''
}

const toLoadMoreFailed = (
  context: Context,
  failure: GasFailure,
  retryHref: string,
  queue?: string | null
): FooterState => {
  const { bucket } = context

  return {
    state: 'error',
    text: `Couldn’t load more ${bucket.noun.many} — ${toFailureText(failure, bucket.service)}${failedQueueText(context, queue)}`,
    retryHref,
    noun: bucket.noun.many
  }
}

const toHead = (bucket: BucketEntry) => ({
  label: capitalise(bucket.noun.many),
  columns: toListColumns(bucket).map(({ key, label, width, mono, align }) => ({
    key,
    label,
    width,
    mono,
    align
  })),
  narrowColumns:
    presentationOf(bucket).narrowColumns?.map(({ label, width, align }) => ({
      label,
      width,
      align
    })) ?? null
})

/** Each row's page and place on it, the pages in the order they were read. */
const toPlaces = ({ page, pageRows }: Context, count: number): RowPlace[] => {
  const sizes = pageRows.length ? pageRows : [count]

  return sizes.flatMap((size, n) =>
    Array.from({ length: size }, (_, index) => ({
      page: page + n,
      index: index + 1
    }))
  )
}

const pagesText = (count: number): string =>
  `${count} ${count === 1 ? 'page' : 'pages'}`

/** The restore ran out of time itself, with no queue failing it. */
const isOutOfTime = ({ read, queue }: StoppedPage): boolean =>
  read.kind === 'failed' && read.failure.kind === 'timed-out' && queue === null

/** A later page that couldn't be read is said in the footer, under the rows read before it; one the restore ran out of time for goes on from there. */
const toStoppedFooter = (
  context: Context,
  stopped: StoppedPage
): FooterState => {
  const { cursor, read, queue } = stopped
  const retryHref = toCursorHref(context, cursor, lastPageOf(context) + 1)

  if (isOutOfTime(stopped)) {
    return {
      state: 'error',
      text: `Stopped after ${pagesText(context.pageRows.length)} to answer in time.`,
      retryHref,
      noun: context.bucket.noun.many
    }
  }

  return toLoadMoreFailed(
    context,
    read.kind === 'failed'
      ? read.failure
      : {
          kind: 'refused',
          statusCode: statusCodes.badRequest,
          errorCode: null
        },
    retryHref,
    queue
  )
}

const toRows = (
  context: Context,
  input: ListPageInput,
  set: string[],
  result: BucketResult
) => {
  const places = toPlaces(context, result.rows.length)
  const toListRow = toRow(context, toListColumns(context.bucket))
  const rows = result.rows.map((row, n) => toListRow(row, places[n]))
  const footer = input.stopped
    ? toStoppedFooter(context, input.stopped)
    : toFooterState(context, result)
  const empty =
    rows.length || input.cursor ? null : toEmpty(context, set, footer)

  return { rows, empty, footer: withRestore(context, footer) }
}

const toTable = (
  context: Context,
  input: ListPageInput,
  set: string[],
  retryHref: string
): TableModel | null => {
  const head = toHead(context.bucket)
  const failure = failureOf(input.read)

  // A later page that couldn't be read: no rows, and a retry of that page.
  if (failure && input.cursor) {
    return {
      ...head,
      rows: [],
      empty: null,
      footer: withRestore(
        context,
        toLoadMoreFailed(context, failure, retryHref, input.failedQueue)
      )
    }
  }

  return (
    context.result && {
      ...head,
      ...toRows(context, input, set, context.result)
    }
  )
}

/** Every list names its service under the title. */
const toMeta = (bucket: BucketEntry): string[] => [
  toServiceName(bucket.service)
]

const searchOf = (search: ListPageInput['search']) => {
  const searched = search ? toSearched(search.q) : null

  return { searched, searchId: searched && search ? search.id : null }
}

const pagesOf = ({ cursor, page, pageRows }: ListPageInput) => ({
  cursor: cursor ?? null,
  page: page ?? 1,
  pageRows: pageRows ?? []
})

/** The list's own address, filters and range, sent in a form: Explore reads the search from the session, as the list does. */
const toExploreForm = ({ bucket, filters }: Context): HiddenForm | null =>
  opensInExplore(bucket)
    ? {
        id: exploreFormId,
        action: explorePath,
        hidden: [
          { name: 'from', value: bucket.path },
          {
            name: 'list',
            value: toBucketHref(bucket, filters).split('?')[1] ?? ''
          }
        ]
      }
    : null

const toContext = (input: ListPageInput): Context => ({
  bucket: input.bucket,
  filters: input.filters,
  result: input.read?.kind === 'read' ? input.read.page : null,
  times: input.times,
  now: input.now ?? new Date(),
  ...searchOf(input.search),
  ...pagesOf(input)
})

/** This very page again: a later page by its cursor, or every page it restored. */
const toRetryHref = (
  context: Context,
  { cursor, through }: ListPageInput
): string => {
  if (cursor) {
    return toCursorHref(context, cursor, context.page)
  }

  return through
    ? toRestoreHref(context, through)
    : toBucketHref(context.bucket, context.filters)
}

/** A held search is dropped by Clear all too, which a bare link can't do: one the error in the address set aside included. */
const toClearAllHref = (context: Context): string =>
  toShownSearch(context)
    ? `${toBucketPath(context.bucket)}?${clearParam}=all`
    : toBucketPath(context.bucket)

export const toListPage = (input: ListPageInput): ListPageModel => {
  const { bucket } = input
  const context = toContext(input)
  const retryHref = toRetryHref(context, input)
  const range = toRange(context)
  const applied = toApplied(context)

  return {
    pageTitle: bucket.label,
    navActive: bucket.id,
    title: bucket.shortLabel,
    meta: toMeta(bucket),
    filterLabel: `Filter ${bucket.noun.many}`,
    chips: toChipOrder(bucket, bucket.facts.filter(hasValues)).map(
      toChip(context)
    ),
    range,
    searchField: toSearchField(context, input.attempt),
    applied,
    filtered: applied.length > 0,
    total: toTotal(context),
    clearAllHref: toClearAllHref(context),
    exploreForm: toExploreForm(context),
    alert: toAlert(input, context, retryHref),
    table: toTable(context, input, toSetNames(context, range), retryHref)
  }
}

/**
 * CW's lists are missing from the catalogue because GAS couldn't reach CW:
 * the page says so in place of the list. Its filters come from the missing
 * entries, so none can be drawn.
 */
export const toCaseworkingUnreachable = (
  list: CaseworkingList,
  retryHref: string
): ListPageModel => ({
  pageTitle: list.pageLabel,
  navActive: list.id,
  title: list.shortLabel,
  meta: [toServiceName('CW')],
  filterLabel: `Filter ${list.noun}`,
  chips: [],
  range: null,
  searchField: null,
  applied: [],
  filtered: false,
  total: null,
  clearAllHref: '',
  exploreForm: null,
  alert: {
    tone: 'danger',
    title: 'Caseworking can’t be reached.',
    code: null,
    text: `GAS is up, but its calls to CW are failing, so CW’s ${list.noun} can’t be listed. Nothing has changed.`,
    retryHref,
    startHref: null,
    links: []
  },
  table: null
})

export const badRequest = statusCodes.badRequest

/** A later page of a search no longer held, asked for in place: nothing of it to add, and the first page to go to instead. */
export const staleSearchCode = statusCodes.conflict

/** GAS answered, but without CW's lists: the page can only say so. */
export const caseworkingUnreachableCode = statusCodes.serviceUnavailable

const failureOf = (read: BucketListResult | null): GasFailure | null =>
  read?.kind === 'failed' ? read.failure : null

const failedCode = (failure: GasFailure | null): number => {
  if (failure === null) {
    return statusCodes.ok
  }

  return isUnanswered(failure)
    ? statusCodes.gatewayTimeout
    : statusCodes.serviceUnavailable
}

/** Refusals said before GAS is asked: nothing was read. */
const addressRefusals = new Set(['address', 'range'])

const isAddressRefusal = (refusal: ListRefusal | undefined): boolean =>
  refusal !== undefined && addressRefusals.has(refusal.kind)

const isRefused = ({ read, refusal }: ListPageInput): boolean =>
  isAddressRefusal(refusal) || read?.kind === 'refused'

/** A list that couldn't be read is no list: the status says why. */
export const toListStatusCode = (input: ListPageInput): number =>
  isRefused(input) ? badRequest : failedCode(failureOf(input.read))
