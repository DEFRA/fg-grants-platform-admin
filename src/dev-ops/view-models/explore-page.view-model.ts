import { statusCodes } from '../../common/status-codes.ts'
import type {
  ExploreAnswer,
  ExploreColumn,
  ExploreFailure,
  ExploreOpen,
  ExploreService,
  ExploreSkipped,
  ExploreSource,
  QueryError
} from '../use-cases/explore-calls.ts'
import type {
  ExploreNotice,
  ExplorePageData
} from '../use-cases/explore-page.ts'
import { queryMax, toExamples, toIdText } from '../use-cases/explore-queries.ts'
import { pageMax, restoreMax, toFound } from '../use-cases/held-runs.ts'
import type { HeldPage, RecentQuery } from '../use-cases/held-runs.ts'
import type { BucketLink } from '../repositories/buckets.repository.ts'
import { toRowHref } from './bucket-links.ts'
import { devOpsPath, exploreNavId, explorePath } from './bucket-nav.ts'
import { recordsOf, toCell, toNumberText } from './explore-cells.ts'
import type { ExploreCellModel } from './explore-cells.ts'
import { toRecentLabel } from './explore-queries.view-model.ts'
import { toFailureText } from './failure-text.ts'
import {
  noVocabulary,
  toEditorVocabulary
} from './explore-vocabulary.view-model.ts'
import type { EditorVocabulary } from './explore-vocabulary.view-model.ts'
import { toTime } from './times.ts'
import type { Times, TimeText } from './times.ts'

export { explorePath }

export const exploreCsvPath = `${devOpsPath}/explore.csv`

/** Every Explore response: a page or a file holding what a query found is never kept by a browser. */
export const explorePageCache = { otherwise: 'no-store' }

/** Long enough for any query the editor takes, so a longer one is said at the field rather than refused unread. */
export const postedMax = queryMax * 4

export const toRunHref = (id: string, page = 1): string =>
  page > 1
    ? `${explorePath}?run=${encodeURIComponent(id)}&page=${page}`
    : `${explorePath}?run=${encodeURIComponent(id)}`

/** The address that draws every window of a run from the first through `through`, at most `restoreMax`: only the run's id and a window's number. */
export const toRestoreHref = (id: string, through: number): string =>
  through > 1
    ? `${explorePath}?run=${encodeURIComponent(id)}&through=${Math.min(through, restoreMax)}`
    : toRunHref(id)

/** Set when a way in holds a new run, and taken by the next GET: only the Run's own landing has it, not a reload. */
export const exploreArrivalKey = 'exploreArrival'

/** Keep looking in place on a run no longer held answers this, with the run's address, so the loader goes there. */
export const goneStatusCode = statusCodes.conflict

const serviceNames: Record<ExploreService, string> = {
  GAS: 'The Grant Application Service',
  CW: 'Caseworking'
}

export interface ExplorePageInput extends ExplorePageData {
  times: Times
  now: Date
  /** The page answers a Run of this run, so the count takes focus; not a reload or a later window. */
  arrived: boolean
  /** The page answers Keep looking's loader, which appends its rows and footer to the page it has. */
  inPlace?: boolean
}

type Run = NonNullable<ExplorePageInput['run']>

export interface ExploreAlert {
  tone: 'info' | 'warning' | 'danger'
  title: string
  text: string | null
  retryHref: string | null
  startHref: string | null
}

/** A Queries menu item: a submit of the editor's form, naming what to run in `pick`. */
export interface ExploreMenuItem {
  text: string
  value: string
}

export interface ExploreRowModel {
  /** Its window and place in it, which Back from its record lands on. */
  id: string
  /** Past the most a restore draws, the address that draws the row's window; else the loader's address through every window shown. */
  restoreHref: string | null
  href: string | null
  cells: ExploreCellModel[]
}

/** `path`: the label is a dotted stored path, drawn as one. `max`: a sticky first column's cells are cut at 40ch. */
export interface ExploreColumnModel {
  key: string
  label: string
  width: 'minmax(160px, 1fr)'
  max?: 40
  align?: 'right'
  path?: true
  mono?: true
}

/** A record too large to search: its `_id` as a query writes it, and the link that opens it, where it has a page. */
export interface SkippedRecord {
  id: string
  open: { text: string; label: string; href: string } | null
}

/** Records a window skipped as too large to search, which may or may not match. */
export interface SkippedNote {
  text: string
  records: SkippedRecord[]
}

/** Keep looking posts the run and the window it reads; nothing of the query goes with it. */
export interface KeepLookingForm {
  action: string
  fields: { run: string; page: string }
}

/** `restoreHref` draws every row shown through this window, for the loader to put in the address bar. */
export type ExploreFooter =
  | {
      state: 'searched'
      searchedTo: TimeText
      form: KeepLookingForm | null
      note: SkippedNote | null
      restoreHref: string
    }
  | {
      state: 'more'
      text: string
      form: KeepLookingForm
      note: SkippedNote | null
      restoreHref: string
    }
  | {
      state: 'end'
      text: string
      note: SkippedNote | null
      restoreHref: string
    }
  | { state: 'error'; text: string; retryHref: string }

/** With no row shown, Keep looking is here rather than in the footer, so it draws the next window's own page and nothing goes stale. */
export interface ExploreEmpty {
  title: string
  text: string
  icon: string
  note: SkippedNote | null
  keepLooking: KeepLookingForm | null
}

export interface ExploreResults {
  label: string
  /** Null for a count, whose one cell says it. */
  count: string | null
  /** The count takes focus: the page answers a Run. */
  arrived: boolean
  csv: { action: string; run: string }
  /** A listed `_id` leads, a column like the others: nothing sticks, and its row link is at the text's weight. */
  idFirst: boolean
  columns: ExploreColumnModel[]
  rows: ExploreRowModel[]
  /** The paths the query reads that no definition names, said above the table; null when it names none. */
  unseen: string | null
  empty: ExploreEmpty | null
  footer: ExploreFooter | null
  noun: string
}

export interface ExplorePage {
  pageTitle: string
  meta: string[]
  navActive: string
  action: string
  /** Your recent queries, none when there are none, then the examples. */
  queries: { recent: ExploreMenuItem[]; examples: ExploreMenuItem[] }
  editor: {
    value: string
    error: QueryError | null
    vocabulary: EditorVocabulary
  }
  alert: ExploreAlert | null
  results: ExploreResults | null
}

const toQueries = (recent: RecentQuery[], now: Date) => ({
  recent: recent.map(
    ({ id, q }): ExploreMenuItem => ({ text: toRecentLabel(q), value: id })
  ),
  examples: toExamples(now).map(
    ({ slug, label }): ExploreMenuItem => ({ text: label, value: slug })
  )
})

const tryAgain = (title: string, href: string): ExploreAlert => ({
  tone: 'danger',
  title,
  text: 'Nothing has changed: try again.',
  retryHref: href,
  startHref: null
})

const refusedBy = (service: ExploreService, text: string | null) => ({
  tone: 'warning' as const,
  title: `${serviceNames[service]} refused this query.`,
  text,
  retryHref: null,
  startHref: explorePath
})

/** GAS names the source's indexed paths when it says why; without that, the editor marks them. */
const tooSlow = 'It took too long. Narrow it with an indexed path.'

type AlertFailure = Exclude<ExploreFailure, { kind: 'invalid' }>

type ByKind<U extends { kind: string }, A extends unknown[], R> = {
  [K in U['kind']]: (item: Extract<U, { kind: K }>, ...rest: A) => R
}

/** What each way a run fails says; a failure a person can retry links back to the run. */
const failureAlerts: ByKind<AlertFailure, [string], ExploreAlert> = {
  refused: ({ service, message }) => refusedBy(service, message),
  'too-large': ({ message }) => ({
    tone: 'warning',
    title: 'This answer is too large to show.',
    text: message ?? 'Set a lower .limit() or name fewer paths.',
    retryHref: null,
    startHref: null
  }),
  'too-slow': ({ service, message }) => refusedBy(service, message ?? tooSlow),
  busy: (_, selfHref) => ({
    tone: 'warning',
    title: 'You already have a query running.',
    text: 'Wait for it to finish, then try again.',
    retryHref: selfHref,
    startHref: null
  }),
  full: ({ service }, selfHref) => ({
    tone: 'warning',
    title: `${serviceNames[service]} is running as many queries as it can.`,
    text: 'Try again in a moment.',
    retryHref: selfHref,
    startHref: null
  }),
  errored: ({ service }, selfHref) =>
    tryAgain(`${serviceNames[service]} answered with an error.`, selfHref),
  unavailable: ({ service }, selfHref) => ({
    tone: 'warning',
    title: `${serviceNames[service]} can’t run queries at the moment.`,
    text: 'Nothing was read. Try again later.',
    retryHref: selfHref,
    startHref: null
  }),
  'no-answer': ({ service, failure }, selfHref) =>
    tryAgain(
      toFailureText(
        failure,
        service,
        (who) => `${serviceNames[who as ExploreService]} didn’t answer in time.`
      ),
      selfHref
    )
}

const toFailureAlert = (failure: AlertFailure, selfHref: string) =>
  (failureAlerts[failure.kind] as (f: AlertFailure, h: string) => ExploreAlert)(
    failure,
    selfHref
  )

const notFound: Record<'business' | 'sbi', string> = {
  business: 'business name',
  sbi: 'SBI'
}

const noticeAlerts: ByKind<
  ExploreNotice,
  [],
  Pick<ExploreAlert, 'tone' | 'title' | 'text'>
> = {
  expired: () => ({
    tone: 'info',
    title: 'This query has expired.',
    text: 'Run it again.'
  }),
  'no-value': ({ noun, by }) => ({
    tone: 'info',
    title: `This ${noun} has no ${notFound[by]} recorded.`,
    text: 'There are no others to find by it.'
  })
}

const toNoticeAlert = (notice: ExploreNotice): ExploreAlert => ({
  ...(noticeAlerts[notice.kind] as (n: ExploreNotice) => ExploreAlert)(notice),
  retryHref: null,
  startHref: null
})

const eventServices = { GAS: 'gas', CW: 'caseworking' }

/** Each record a row can name: the link its page is found by, what opening it says, and which record it is. */
interface Opening {
  link: BucketLink
  text: string
  which: string
}

const openings: ByKind<ExploreOpen, [], Opening> = {
  application: ({ code, ref }) => ({
    link: { kind: 'application', code, clientRef: ref },
    text: 'Open application',
    which: ref
  }),
  case: ({ code, ref }) => ({
    link: { kind: 'case', workflowCode: code, caseRef: ref },
    text: 'Open case',
    which: ref
  }),
  grant: ({ code, version }) => ({
    link: { kind: 'grant', code, version },
    text: 'Open grant version',
    which: `${code} ${version}`
  }),
  workflow: ({ code, version }) => ({
    link: { kind: 'workflow', code, version },
    text: 'Open workflow version',
    which: `${code} ${version}`
  }),
  event: ({ service, box, id }) => ({
    link: { kind: 'event', service: eventServices[service], box, id },
    text: 'Open event',
    which: id
  })
}

const toOpening = (open: ExploreOpen): Opening =>
  (openings[open.kind] as (o: ExploreOpen) => Opening)(open)

const toLink = (open: ExploreOpen): BucketLink => toOpening(open).link

const toRowsHref = (open: ExploreOpen | null, back: string): string | null =>
  open ? toRowHref(toLink(open), back) : null

const isRight = ({ kind, aggregate }: ExploreColumn): boolean =>
  kind === 'number' || aggregate

const idPath = '_id'

const isId = (column: ExploreColumn | undefined): boolean =>
  column?.path === idPath

const isDotted = (path: string | null): path is string =>
  path?.includes('.') ?? false

/** A dotted stored path heads its column as a path; any other heading is its label. */
const toHeading = ({ label, path }: ExploreColumn) =>
  isDotted(path) ? { label: path, path: true as const } : { label }

/** A first column sticks unless it is a listed `_id`, which is one value among others. */
const isSticky = (column: ExploreColumn, n: number): boolean =>
  n === 0 && !isId(column)

/** Every column an equal share, as the Events list's, an `_id` too, so the columns stay still as Keep looking adds rows; narrower than 160px each, the table scrolls sideways and CutText cuts what doesn't fit. */
const toColumns = (columns: ExploreColumn[]): ExploreColumnModel[] =>
  columns.map((column, n) => ({
    key: column.key,
    ...toHeading(column),
    width: 'minmax(160px, 1fr)' as const,
    ...(isSticky(column, n) ? { max: 40 as const } : {}),
    ...(isRight(column) ? { align: 'right' as const } : {}),
    ...(isId(column) ? { mono: true as const } : {})
  }))

const toNoun = (source: ExploreSource, n: number): string =>
  n === 1 ? source.noun : source.name

/** Unwound rows are counted as rows, not as the records they came from. */
const toRowNoun = ({ source, unwound }: ExploreAnswer, n: number): string => {
  if (unwound) {
    return n === 1 ? 'row' : 'rows'
  }

  return toNoun(source, n)
}

type Count = NonNullable<ExploreAnswer['count']>

/** How many rows the count says there are: records past the most it counts have no end. */
const counteds: Record<ExploreAnswer['mode'], (count: Count) => number> = {
  rows: ({ n, capped }) => (capped ? Infinity : n),
  groups: ({ groups }) => groups ?? 0,
  distinct: ({ groups }) => groups ?? 0,
  count: () => 0
}

const countedOf = ({ mode, count }: ExploreAnswer): number =>
  count === null ? 0 : counteds[mode](count)

/** The rows are only the first of what the count counts. */
const isCut = (answer: ExploreAnswer): boolean =>
  answer.rows.length < countedOf(answer)

const counted = (n: number, capped: boolean): string =>
  `${toNumberText(n)}${capped ? '+' : ''}`

/** The count, then, when the rows are only the first of what it counts, how many they are. */
const withFirst = (total: string, answer: ExploreAnswer): string =>
  isCut(answer)
    ? `${total}, the first ${toNumberText(answer.rows.length)}`
    : total

const groupNouns = {
  groups: ['group', 'groups'],
  distinct: ['value', 'values']
}

/** How many groups, or distinct values, there are in all, and when the rows are only the first. */
const toGroups = (answer: ExploreAnswer, [one, many]: string[]): string => {
  const groups = answer.count?.groups ?? answer.rows.length

  return withFirst(
    `${toNumberText(groups)} ${groups === 1 ? one : many}`,
    answer
  )
}

const toSoFar = (source: ExploreSource, found: number): string =>
  `${toNumberText(found)} ${toNoun(source, found)} found so far`

const toTotal = (
  answer: ExploreAnswer,
  { n, capped }: { n: number; capped: boolean }
): string =>
  withFirst(
    `${counted(n, capped)} ${toRowNoun(answer, capped ? 2 : n)}`,
    answer
  )

const toRowsCount = (answer: ExploreAnswer, found: number): string =>
  answer.count === null
    ? toSoFar(answer.source, found)
    : toTotal(answer, answer.count)

/** How many, by what the query asked for: a count's own cell says it, so it has no line. */
const counts: Record<
  ExploreAnswer['mode'],
  (answer: ExploreAnswer, found: number) => string | null
> = {
  count: () => null,
  groups: (answer) => toGroups(answer, groupNouns.groups),
  distinct: (answer) => toGroups(answer, groupNouns.distinct),
  rows: toRowsCount
}

const toCount = (answer: ExploreAnswer, found: number): string | null =>
  counts[answer.mode](answer, found)

type Window = NonNullable<ExploreAnswer['window']>

/** Its `_id` as a query writes it, and a link to its page where it has one. */
const toSkippedRecord = (
  { open, id }: ExploreSkipped,
  back: string
): SkippedRecord => {
  const href = toRowsHref(open, back)

  if (open === null || href === null) {
    return { id: toIdText(id), open: null }
  }

  const { text, which } = toOpening(open)

  return {
    id: toIdText(id),
    open: { text, label: `${text} ${which}`, href }
  }
}

/** Not searched, so not known to match: every one, by its `_id`. */
const toNote = ({ skipped }: Window, run: Run): SkippedNote | null => {
  if (!skipped.length) {
    return null
  }

  const back = toWindowRestore(run, run.page)
  const they = skipped.length === 1 ? 'it' : 'they'

  return {
    text: `${recordsOf(skipped.length)} too large to search, so ${they} may or may not match:`,
    records: skipped.map((record) => toSkippedRecord(record, back))
  }
}

const toKeepLooking = ({ id, page }: Run): KeepLookingForm => ({
  action: explorePath,
  fields: { run: id, page: String(page + 1) }
})

const atLimit = (window: Window | null, run: Run): boolean =>
  window !== null && !window.end && run.page >= pageMax

const noFurther =
  'Explore reads no further: narrow the query to look further back.'

/** The last window a run may read: how far back it got, and no way on. */
const toLimit = (window: Window, times: Times): string =>
  [
    window.to === null
      ? null
      : `Searched back to ${toTime(new Date(window.to), times).text}.`,
    noFurther
  ]
    .filter((part) => part !== null)
    .join(' ')

/** The most windows a restore of the run draws: fewer once GAS has stopped one for too many cells. */
const restorableOf = ({ restorable }: Run): number => restorable ?? restoreMax

/** Every window through this one; past the most a restore of the run draws, this window alone. */
const toWindowRestore = (run: Run, page: number): string =>
  page > restorableOf(run)
    ? toRunHref(run.id, page)
    : toRestoreHref(run.id, page)

/** The way on from a window that didn't reach the end: a form that posts the run and the next window, never the query. */
const toKeepLookingFooter = (
  window: Window,
  run: Run,
  times: Times,
  note: SkippedNote | null
): ExploreFooter => {
  const way = {
    form: toKeepLooking(run),
    note,
    restoreHref: toWindowRestore(run, run.page)
  }

  return window.to === null
    ? { state: 'more', text: 'Keep looking', ...way }
    : {
        state: 'searched',
        searchedTo: toTime(new Date(window.to), times),
        ...way
      }
}

const toEnd = (
  text: string,
  run: Run,
  note: SkippedNote | null
): ExploreFooter => ({
  state: 'end',
  text,
  note,
  restoreHref: toWindowRestore(run, run.page)
})

/** Where a window stopped, and the way on, unless it reached the end or the last window a run reads; every state says the records it skipped. */
const toFooter = (
  { window }: ExploreAnswer,
  run: Run,
  times: Times
): ExploreFooter | null => {
  if (window === null) {
    return null
  }

  const note = toNote(window, run)

  if (window.end) {
    return toEnd('Searched everything.', run, note)
  }

  return atLimit(window, run)
    ? toEnd(toLimit(window, times), run, note)
    : toKeepLookingFooter(window, run, times, note)
}

/** A restore GAS stopped before the window its address asked for may pass, so Retry. */
const toRestoredFooter = (
  answer: ExploreAnswer,
  run: Run,
  times: Times
): ExploreFooter | null =>
  run.stopped ? toLoadFailed(answer.source, run) : toFooter(answer, run, times)

const nothingMatches = 'Nothing matches'

const toEmpty = ({ source, window }: ExploreAnswer, run: Run) => {
  if (atLimit(window, run)) {
    return { title: nothingMatches, text: noFurther, icon: 'search' }
  }

  return window && !window.end
    ? {
        title: nothingMatches,
        text: 'Nothing in the records read so far. Keep looking to go further back.',
        icon: 'search'
      }
    : {
        title: nothingMatches,
        text: `No ${source.name} have these values.`,
        icon: 'search'
      }
}

type NothingShown = Pick<ExploreResults, 'empty' | 'footer'>
type Empty = Omit<ExploreEmpty, 'keepLooking' | 'note'>

/** How a footer's Keep looking moves to the empty state: the footer keeps how far back it searched, if it says it. */
const keepLookingMoves: {
  [K in ExploreFooter['state']]?: (
    empty: Empty,
    footer: Extract<ExploreFooter, { state: K }>
  ) => NothingShown
} = {
  searched: (empty, footer) => ({
    empty: { ...empty, note: null, keepLooking: footer.form },
    footer: { ...footer, form: null }
  }),
  more: (empty, { form, note }) => ({
    empty: { ...empty, note, keepLooking: form },
    footer: null
  })
}

/** No row is drawn on the page, so there are none for the loader to keep: Keep looking posts as it does without script. */
const toNothingShown = (
  answer: ExploreAnswer,
  run: Run,
  footer: ExploreFooter | null
): NothingShown => {
  const empty = toEmpty(answer, run)
  const move = footer && keepLookingMoves[footer.state]

  return move
    ? (move as (empty: Empty, footer: ExploreFooter) => NothingShown)(
        empty,
        footer
      )
    : { empty: { ...empty, note: null, keepLooking: null }, footer }
}

const capitalise = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

/** Download CSV posts only the run: the session knows how far it has been read. */
const toCsv = ({ id }: Run) => ({ action: exploreCsvPath, run: id })

/** A mistyped path reads every window and finds nothing, so a path no definition names is said. */
const toUnseen = (paths: string[]): string | null => {
  if (!paths.length) {
    return null
  }

  const named = paths.length === 1 ? 'this path' : 'these paths'

  return `Explore hasn’t seen ${named} in any record’s definition: ${paths.join(', ')}`
}

/** The page's own address: the window it shows, or every window through the one named. */
const toSelfHref = (run: Run | null): string => {
  if (run === null) {
    return explorePath
  }

  return run.through
    ? toRestoreHref(run.id, run.through)
    : toRunHref(run.id, run.page)
}

/** Where a row falls: its window, and its place in that window, from 1. */
interface RowPlace {
  page: number
  index: number
}

const toRowId = ({ page, index }: RowPlace): string => `row-${page}-${index}`

/** Past the most a restore draws, the row's own window; null within it, so the address keeps every window loaded. */
const toRowRestore = (run: Run, { page }: RowPlace): string | null =>
  page > restorableOf(run) ? toRunHref(run.id, page) : null

/** Each row's window and place in it: a restore's windows from the first, else every row in the window shown. */
const toPlaces = ({ page, windowRows }: Run, count: number): RowPlace[] => {
  const first = windowRows ? 1 : page

  return (windowRows ?? [count]).flatMap((size, n) =>
    Array.from({ length: size }, (_, index) => ({
      page: first + n,
      index: index + 1
    }))
  )
}

const toResults = (
  answer: ExploreAnswer,
  { run, previous, times, arrived, inPlace }: ExplorePageInput & { run: Run }
): ExploreResults => {
  const places = toPlaces(run, answer.rows.length)
  const footer = toRestoredFooter(answer, run, times)
  const { columns } = answer

  return {
    label: capitalise(answer.source.name),
    count: toCount(answer, toFound(previous, answer.rows.length)),
    arrived,
    csv: toCsv(run),
    idFirst: isId(columns[0]),
    columns: toColumns(columns),
    unseen: toUnseen(answer.unseen),
    rows: answer.rows.map((row, n) => {
      const id = toRowId(places[n])

      return {
        id,
        restoreHref: toRowRestore(run, places[n]),
        href:
          answer.mode === 'rows'
            ? toRowsHref(
                row.open,
                `${toWindowRestore(run, places[n].page)}#${id}`
              )
            : null,
        cells: columns.map((column) =>
          toCell(row.cells[column.key], column, times, isId(column))
        )
      }
    }),
    ...(answer.rows.length || inPlace
      ? { empty: null, footer }
      : toNothingShown(answer, run, footer)),
    noun: answer.source.name
  }
}

const isOutage = ({ kind }: ExploreFailure): boolean =>
  kind === 'no-answer' || kind === 'errored'

/** Another query of this person's, or too many of everyone's, is running: the window can be read once it finishes. */
const isTooBusy = ({ kind }: ExploreFailure): boolean =>
  kind === 'busy' || kind === 'full'

const isSaidInFooter = (failure: ExploreFailure): boolean =>
  isOutage(failure) || isTooBusy(failure)

/** Said in the footer, with Retry, as a list's next page does. */
const toLoadFailed = (
  source: ExploreSource,
  run: Run,
  text = `Couldn’t load more ${source.name}.`,
  retryHref = toSelfHref(run)
): ExploreFooter => ({ state: 'error', text, retryHref })

/** Why a later window couldn't be read; in place, Retry draws again every window through it, so no row shown is lost, or past the most a restore draws, its own window alone. */
const toLaterWindowFooter = (
  source: ExploreSource,
  run: Run,
  failure: ExploreFailure,
  inPlace?: boolean
): ExploreFooter => {
  if (!isTooBusy(failure)) {
    return toLoadFailed(source, run)
  }

  const retryHref =
    inPlace && run.page <= restorableOf(run)
      ? toRestoreHref(run.id, run.page)
      : toSelfHref(run)
  const { title, text } = toFailureAlert(failure as AlertFailure, retryHref)

  return toLoadFailed(source, run, `${title} ${text}`, retryHref)
}

/** A later window that couldn't be read keeps the page and says so in the footer. */
const toLaterWindowFailure = (
  source: ExploreSource,
  run: Run,
  footer: ExploreFooter
): ExploreResults => ({
  label: capitalise(source.name),
  count: null,
  arrived: false,
  csv: toCsv(run),
  idFirst: false,
  columns: [],
  rows: [],
  unseen: null,
  empty: null,
  footer,
  noun: source.name
})

type Outcome = Pick<ExplorePage, 'alert' | 'results'> & {
  error: QueryError | null
}

const none: Outcome = { alert: null, results: null, error: null }

const isLaterWindow = (run: Run | null): run is Run =>
  run !== null && run.page > 1

const heldSource = (previous: HeldPage | null): ExploreSource | null =>
  previous?.source ?? null

/** A later window GAS or Caseworking couldn't read; null where the page says it instead. */
const toLaterWindow = (
  { run, previous, inPlace }: ExplorePageInput,
  failure: ExploreFailure
): ExploreResults | null => {
  const source = heldSource(previous)

  return source && isLaterWindow(run) && isSaidInFooter(failure)
    ? toLaterWindowFailure(
        source,
        run,
        toLaterWindowFooter(source, run, failure, inPlace)
      )
    : null
}

const toFailed = (
  input: ExplorePageInput,
  failure: ExploreFailure
): Outcome => {
  if (failure.kind === 'invalid') {
    return { ...none, error: failure.error }
  }

  const later = toLaterWindow(input, failure)

  return later
    ? { ...none, results: later }
    : { ...none, alert: toFailureAlert(failure, toSelfHref(input.run)) }
}

const toRead = (input: ExplorePageInput, answer: ExploreAnswer): Outcome =>
  input.run
    ? { ...none, results: toResults(answer, { ...input, run: input.run }) }
    : none

const toOutcome = (input: ExplorePageInput): Outcome => {
  const { result, notice } = input

  if (notice) {
    return { ...none, alert: toNoticeAlert(notice) }
  }

  if (result === null) {
    return none
  }

  return result.outcome === 'read'
    ? toRead(input, result.answer)
    : toFailed(input, result.failure)
}

export const toExplorePage = (input: ExplorePageInput): ExplorePage => {
  const { alert, results, error } = toOutcome(input)

  return {
    pageTitle: 'Explore',
    meta: ['Grant Application Service and Caseworking'],
    navActive: exploreNavId,
    action: explorePath,
    queries: toQueries(input.recent, input.now),
    editor: {
      value: input.q,
      error,
      vocabulary: input.vocabulary
        ? toEditorVocabulary(input.vocabulary)
        : noVocabulary
    },
    alert,
    results
  }
}

const failureCodes: Record<ExploreFailure['kind'], number> = {
  invalid: statusCodes.badRequest,
  refused: statusCodes.badRequest,
  'too-large': statusCodes.badRequest,
  'too-slow': statusCodes.serviceUnavailable,
  busy: statusCodes.tooManyRequests,
  full: statusCodes.tooManyRequests,
  unavailable: statusCodes.serviceUnavailable,
  'no-answer': statusCodes.serviceUnavailable,
  errored: statusCodes.serviceUnavailable
}

/** The loader shows a footer it is answered with only on a success; any other answer, it says it couldn't load more. */
const isSaidInPlace = (input: ExplorePageInput, failure: ExploreFailure) =>
  Boolean(input.inPlace) &&
  isTooBusy(failure) &&
  toLaterWindow(input, failure) !== null

/** 503 for a query a service couldn't answer, as a list that couldn't be read; 400 for one it wouldn't run. */
export const toExploreStatusCode = (input: ExplorePageInput): number => {
  const { result } = input

  if (result?.outcome !== 'failed' || isSaidInPlace(input, result.failure)) {
    return statusCodes.ok
  }

  return failureCodes[result.failure.kind]
}
