import { statusCodes } from '../../common/status-codes.ts'
import { isUnanswered } from '../use-cases/gas-status.ts'
import type { GasFailure } from '../use-cases/gas-status.ts'
import type { ListTotal, Position } from '../use-cases/record-reads.ts'
import type {
  BucketCell,
  BucketEntry,
  BucketFact,
  BucketFactValue,
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'
import type {
  BucketListResult,
  StoppedPage
} from '../use-cases/list-bucket.use-case.ts'
import { toBucketHref, toRowHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { explorePath, toBucketPath } from './bucket-nav.ts'
import type { CaseworkingList } from './bucket-nav.ts'
import { pageMates, toPageHead } from './bucket-tabs.ts'
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
import type { ListColumn, Tone } from './catalogue-presentation.ts'
import { isIsoInstant } from './event-formats.ts'
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
  /** Every list of the catalogue, for the ones that share this one's page. */
  buckets: BucketEntry[]
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
  /** The address came from a later page of a search no longer held. */
  notice?: ListNotice
  attempt?: SearchAttempt
  refusal?: ListRefusal
  now?: Date
}

export type ListNotice = 'expired'

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

/** A removable tag: a link for a filter in the address, a submit for the search the session holds. */
export type Applied = {
  key: string
  label: string
  value: string
  mono: boolean
} & (
  | { removeHref: string }
  | { removeName: string; removeValue: string; removeForm: string }
)

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

interface ClearSearchForm {
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
  | { kind: 'status'; text: string; tone: Tone; hint: string | null }
  | { kind: 'time'; time: TimeText }
  | { kind: 'none' }

interface RowModel {
  /** The row's place in the list, which Back from its page lands on. */
  id: string
  /** The address that draws the row's page, which Back from its page goes to. */
  restoreHref: string
  href: string | null
  cells: (Cell & { align: 'start' | 'right' })[]
}

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
}

export interface ListAlert {
  tone: 'info' | 'warning' | 'danger'
  title: string
  /** Shown in code, before the text: the service's own words. */
  code: string | null
  text: string
  retryHref: string | null
  startHref: string | null
}

export interface ListPageModel {
  pageTitle: string
  navActive: string
  title: string
  meta: string[]
  tabs: {
    label: string
    items: { text: string; href: string; current: boolean }[]
  } | null
  filterLabel: string
  chips: FilterChipModel[]
  /** Null where no filters can be drawn. */
  range: RangeModel | null
  searchField: SearchModel | null
  /** One tag per value a filter is set to, each removing it. */
  applied: Applied[]
  filtered: boolean
  /** How many records the filters find, "12,481 events"; null where the read was bounded or the list couldn't be read. */
  total: string | null
  clearAllHref: string
  clearSearchForm: ClearSearchForm | null
  /** The form Open in Explore sends; null for a list Explore doesn't open. */
  exploreForm: ClearSearchForm | null
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

/** The form a search tag clears the session's search with. */
const clearSearchFormId = 'list-search-clear'

const exploreFormId = 'list-explore'

/** The address Clear all goes to while a search is held: it drops the search too. */
export const clearParam = 'clear'

/** The first page, opened in place of a later page of a search no longer held. */
export const expiredParam = 'expired'

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

/** GAS keys a thrown Error as `Error: <message>`; its tag shows the message, as the Overview's row does. */
const errorKeyFact = 'errorKey'

const shownValue = (fact: BucketFact, value: string): string =>
  fact.name === errorKeyFact ? value.replace(/^Error: /, '') : value

const labelOf = (fact: BucketFact, value: string): string =>
  fact.values?.find((option) => String(option.value) === value)?.label ??
  shownValue(fact, value)

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

const chipText = (fact: BucketFact, chosen: string[]): string => {
  if (chosen.length > 1) {
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

const toSearchField = (
  { bucket, filters, searched }: Context,
  attempt?: SearchAttempt
): SearchModel | null => {
  const shown = { kind: '', value: '', error: null, ...searched, ...attempt }

  return bucket.refs.length === 0
    ? null
    : {
        action: toBucketPath(bucket),
        value: shown.value,
        error: shown.error,
        noun: bucket.noun.many,
        hidden: toUrlFields(bucket, filters),
        kinds: bucket.refs.map(({ kind, label }, index) => ({
          text: label,
          value: kind,
          checked: shown.kind ? kind === shown.kind : index === 0
        }))
      }
}

const kindLabel = ({ refs }: BucketEntry, kind: string): string | null =>
  refs.find((ref) => ref.kind === kind)?.label ?? null

const timeTags = (
  { bucket, filters }: Context,
  range: RangeModel
): Applied[] =>
  range.isSet
    ? [
        {
          key: 'time',
          label: range.label,
          value: range.text,
          mono: false,
          removeHref: toBucketHref(bucket, withoutRange(filters))
        }
      ]
    : []

const searchTags = ({ bucket, searched }: Context): Applied[] => {
  const label = searched && kindLabel(bucket, searched.kind)

  return searched && label
    ? [
        {
          key: 'search',
          label,
          value: searched.value,
          mono: true,
          removeName: 'ref-value',
          removeValue: '',
          removeForm: clearSearchFormId
        }
      ]
    : []
}

/** The words a summary stores for the rows that hold no value of a fact ("No error recorded"): said as words, not a code. */
const isNoneOf = (bucket: BucketEntry, fact: string, value: string): boolean =>
  bucket.summaries.some(({ by, none }) => by.includes(fact) && none === value)

/** Every filter set, in the row's order: the time, the chosen values, the search, then the open facts. */
const toSetFilters = (context: Context, range: RangeModel): Applied[] => {
  const { bucket } = context
  const valueTag =
    (fact: BucketFact, chosen: string[]) =>
    (value: string): Applied => ({
      key: fact.name,
      label: toFactLabel(bucket, fact),
      value: labelOf(fact, value),
      mono: !hasValues(fact) && !isNoneOf(bucket, fact.name, value),
      removeHref: hrefWith(
        context,
        fact.name,
        chosen.filter((one) => one !== value)
      )
    })
  const tagsOf = (fact: BucketFact) => {
    const chosen = chosenOf(context, fact.name)

    return inMenuOrder(bucket, fact, chosen).map(valueTag(fact, chosen))
  }

  return [
    ...timeTags(context, range),
    ...toChipOrder(bucket, bucket.facts.filter(hasValues)).flatMap(tagsOf),
    ...searchTags(context),
    ...bucket.facts.filter((fact) => !hasValues(fact)).flatMap(tagsOf)
  ]
}

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

const toPositionText = (value: CellValue): Cell =>
  typeof value === 'object'
    ? { kind: 'text', text: toPositionLabel(value as Position), mono: false }
    : { kind: 'text', text: String(value), mono: false }

type Draw = (context: Context, column: ListColumn, value: CellValue) => Cell

/** A format this page has not heard of is drawn as text, so a new one never breaks a list. */
const draws: Record<string, Draw> = {
  badge: toStatus,
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
    toCatalogueCell(context, { ...column, format: 'text' }, row.subtitle),
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

const toRow =
  (context: Context, columns: ListColumn[]) =>
  (row: BucketRow, place: RowPlace): RowModel => {
    const id = toRowId(place)
    const restoreHref = toPlaceHref(context, place.page)
    const href = toRowHref(row.link, `${restoreHref}#${id}`)

    return {
      id,
      restoreHref,
      href,
      cells: columns.map((column) => ({
        ...cells[column.kind](context, column, row, href),
        align: column.align
      }))
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

const isOnlySearch = (applied: Applied[]): boolean =>
  applied.length === 1 && applied[0].key === 'search'

/** A search on: it names what had no match, under any filters beside it. */
const searchMiss = (
  { bucket, searched }: Context,
  applied: Applied[]
): string | null => {
  const label = searched && kindLabel(bucket, searched.kind)
  const which = isOnlySearch(applied) ? '' : ' with these filters'

  return (
    label && `No ${bucket.noun.many}${which} have this ${inSentence(label)}.`
  )
}

const toNoMatch = (context: Context, applied: Applied[]): EmptyModel => ({
  title: `No ${context.bucket.noun.many} match`,
  text:
    searchMiss(context, applied) ??
    presentationOf(context.bucket).noMatchText ??
    'Nothing matches these filters.',
  icon: 'search'
})

const toEmpty = (
  context: Context,
  applied: Applied[],
  footer: FooterState | null
): EmptyModel => {
  if (footer?.state === 'searched') {
    return soFar
  }

  return applied.length ? toNoMatch(context, applied) : toNothingYet(context)
}

const toAddressRefusal = (startHref: string): ListAlert => ({
  tone: 'warning',
  title: 'This address has a filter the list doesn’t have.',
  code: null,
  text: 'Nothing was read. Start again to see the list.',
  retryHref: null,
  startHref
})

const toRangeRefusal = (startHref: string): ListAlert => ({
  tone: 'warning',
  title: 'This address has a time range the list can’t read.',
  code: null,
  text: 'Its start and end must be dates, the start no later than the end. Nothing was read. Start again to see the list.',
  retryHref: null,
  startHref
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
  startHref
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
  startHref
})

/** GAS's own error is worth looking up in its logs. */
const toUnavailableText = (failure: GasFailure, service: string): string => {
  const text = `${toFailureText(failure, service)} Nothing has changed — try again in a moment`

  return failure.kind === 'errored' || failure.kind === 'refused'
    ? `${text}; if it keeps failing, check GAS’s logs.`
    : `${text}.`
}

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
  startHref: null
})

/** Searches are held for a while only: a later page of one gone opens the first page, saying why. */
const expiredNotice: ListAlert = {
  tone: 'info',
  title: 'This search has expired.',
  code: null,
  text: 'Search again to see its results.',
  retryHref: null,
  startHref: null
}

type AlertRule = (
  input: ListPageInput,
  startHref: string,
  retryHref: string
) => ListAlert | null

/** The first that applies is the page's alert; a later page's failure is said in its footer instead. */
const alertRules: AlertRule[] = [
  ({ refusal }, start) =>
    refusal?.kind === 'address' ? toAddressRefusal(start) : null,
  ({ refusal }, start) =>
    refusal?.kind === 'range' ? toRangeRefusal(start) : null,
  ({ bucket, refusal }, start) =>
    refusal?.kind === 'search'
      ? toSearchRefusal(bucket, refusal.message, start)
      : null,
  ({ bucket, read }, start) =>
    read?.kind === 'refused'
      ? toFilterRefusal(bucket, read.refusal, start)
      : null,
  ({ bucket, read, cursor }, _start, retry) =>
    read?.kind === 'failed' && !cursor
      ? toUnavailableAlert(bucket, read.failure, retry)
      : null,
  ({ notice }) => (notice === 'expired' ? expiredNotice : null)
]

const toAlert = (input: ListPageInput, retryHref: string): ListAlert | null =>
  alertRules
    .map((rule) => rule(input, toBucketPath(input.bucket), retryHref))
    .find((alert) => alert !== null) ?? null

const toLoadMoreFailed = (
  bucket: BucketEntry,
  failure: GasFailure,
  retryHref: string
): FooterState => ({
  state: 'error',
  text: `Couldn’t load more ${bucket.noun.many} — ${toFailureText(failure, bucket.service)}`,
  retryHref,
  noun: bucket.noun.many
})

const toHead = (bucket: BucketEntry) => ({
  label: capitalise(bucket.noun.many),
  columns: toListColumns(bucket).map(({ key, label, width, mono, align }) => ({
    key,
    label,
    width,
    mono,
    align
  }))
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

/** A later page that couldn't be read is said in the footer, under the rows read before it. */
const toStoppedFooter = (
  context: Context,
  { cursor, read }: StoppedPage
): FooterState =>
  toLoadMoreFailed(
    context.bucket,
    read.kind === 'failed'
      ? read.failure
      : {
          kind: 'refused',
          statusCode: statusCodes.badRequest,
          errorCode: null
        },
    toCursorHref(context, cursor, lastPageOf(context) + 1)
  )

const toRows = (
  context: Context,
  input: ListPageInput,
  applied: Applied[],
  result: BucketResult
) => {
  const places = toPlaces(context, result.rows.length)
  const toListRow = toRow(context, toListColumns(context.bucket))
  const rows = result.rows.map((row, n) => toListRow(row, places[n]))
  const footer = input.stopped
    ? toStoppedFooter(context, input.stopped)
    : toFooterState(context, result)
  const empty =
    rows.length || input.cursor ? null : toEmpty(context, applied, footer)

  return { rows, empty, footer: withRestore(context, footer) }
}

const toTable = (
  context: Context,
  input: ListPageInput,
  applied: Applied[],
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
        toLoadMoreFailed(context.bucket, failure, retryHref)
      )
    }
  }

  return (
    context.result && {
      ...head,
      ...toRows(context, input, applied, context.result)
    }
  )
}

/** The page a list is drawn on: the service's events, with a tab per queue, or the list itself. */
const tabsLabelOf = (bucket: BucketEntry): string =>
  presentationOf(bucket).tabsLabel ?? bucket.page?.label ?? ''

const toTabs = (
  bucket: BucketEntry,
  buckets: BucketEntry[],
  filters: BucketFilters
) => {
  const { tabs } = toPageHead(bucket, pageMates(bucket, buckets), filters)

  return tabs.length
    ? {
        label: tabsLabelOf(bucket),
        items: tabs.map(({ label, href, active }) => ({
          text: label,
          href,
          current: active
        }))
      }
    : null
}

/** Every list names its service under the title. */
const toMeta = (bucket: BucketEntry): string[] => [
  toServiceName(bucket.service)
]

const searchOf = (search: ListPageInput['search']) => {
  const searched = search ? toSearched(search.q) : null

  return { searched, searchId: searched && search ? search.id : null }
}

const toClearSearchForm = ({
  bucket,
  filters,
  searched
}: Context): ClearSearchForm | null =>
  searched
    ? {
        id: clearSearchFormId,
        action: toBucketPath(bucket),
        hidden: toUrlFields(bucket, filters)
      }
    : null

const pagesOf = ({ cursor, page, pageRows }: ListPageInput) => ({
  cursor: cursor ?? null,
  page: page ?? 1,
  pageRows: pageRows ?? []
})

/** The list's own address, filters and range, sent in a form: Explore reads the search from the session, as the list does. */
const toExploreForm = ({ bucket, filters }: Context): ClearSearchForm | null =>
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

/** A held search is dropped by Clear all too, which a bare link can't do. */
const toClearAllHref = ({ bucket, searched }: Context): string =>
  searched ? `${toBucketPath(bucket)}?${clearParam}=all` : toBucketPath(bucket)

export const toListPage = (input: ListPageInput): ListPageModel => {
  const { bucket, buckets } = input
  const context = toContext(input)
  const retryHref = toRetryHref(context, input)
  const range = toRange(context)
  const set = toSetFilters(context, range)
  const title = bucket.page?.shortLabel ?? bucket.shortLabel

  return {
    pageTitle: bucket.label,
    navActive: bucket.id,
    title,
    meta: toMeta(bucket),
    tabs: toTabs(bucket, buckets, context.filters),
    filterLabel: `Filter ${bucket.noun.many}`,
    chips: toChipOrder(bucket, bucket.facts.filter(hasValues)).map(
      toChip(context)
    ),
    range,
    searchField: toSearchField(context, input.attempt),
    applied: set,
    filtered: set.length > 0,
    total: toTotal(context),
    clearAllHref: toClearAllHref(context),
    clearSearchForm: toClearSearchForm(context),
    exploreForm: toExploreForm(context),
    alert: toAlert(input, retryHref),
    table: toTable(context, input, set, retryHref)
  }
}

/**
 * CW's lists are missing from the catalogue because GAS couldn't reach CW:
 * the page says so in place of the list. Its tabs and filters come from the
 * missing entries, so none can be drawn.
 */
export const toCaseworkingUnreachable = (
  list: CaseworkingList,
  retryHref: string
): ListPageModel => ({
  pageTitle: list.pageLabel,
  navActive: list.id,
  title: list.shortLabel,
  meta: [toServiceName('CW')],
  tabs: null,
  filterLabel: `Filter ${list.noun}`,
  chips: [],
  range: null,
  searchField: null,
  applied: [],
  filtered: false,
  total: null,
  clearAllHref: '',
  clearSearchForm: null,
  exploreForm: null,
  alert: {
    tone: 'danger',
    title: 'Caseworking can’t be reached.',
    code: null,
    text: `GAS is up, but its calls to CW are failing, so CW’s ${list.noun} can’t be listed. Nothing has changed.`,
    retryHref,
    startHref: null
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
