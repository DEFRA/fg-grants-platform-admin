import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { BucketEntry } from '../use-cases/shell-catalogue.ts'
import {
  readShellUseCase,
  shellCatalogue
} from '../use-cases/shell-catalogue.ts'
import type {
  AddressRefusal,
  BucketListing,
  ListAsk,
  ListOutcome
} from '../use-cases/list-bucket.use-case.ts'
import { listBucketUseCase } from '../use-cases/list-bucket.use-case.ts'
import type { BucketFilters } from '../view-models/bucket-links.ts'
import {
  devOpsPath,
  toCaseworkingListAt,
  toHomeHref
} from '../view-models/bucket-nav.ts'
import type { CaseworkingList } from '../view-models/bucket-nav.ts'
import { fromUrlQuery, withOfferedValues } from '../view-models/bucket-urls.ts'
import { listPageCache, toFilterHref } from '../view-models/list-filters.ts'
import {
  badRequest,
  caseworkingUnreachableCode,
  clearParam,
  expiredParam,
  restoreMax,
  staleSearchCode,
  toCaseworkingUnreachable,
  toListPage,
  toListStatusCode
} from '../view-models/list-page.view-model.ts'
import type {
  ListNotice,
  ListPageInput,
  SearchAttempt
} from '../view-models/list-page.view-model.ts'
import { seeOther } from '../view-models/see-other.ts'
import {
  clearSearch,
  forgetRefused,
  peekSearch,
  storeSearch,
  searchError,
  takeSearch,
  toSearchKey,
  toSearchQuery
} from '../view-models/stored-search.ts'
import type { SearchToRun } from '../view-models/stored-search.ts'
import {
  isReadableWindow,
  pinQuickRange,
  timeRangeFilters,
  toRangeInstants
} from '../view-models/time-range.view-model.ts'
import type { TimeRangeQuery } from '../view-models/time-range.view-model.ts'
import { shellQuery, timesOf, withoutShellKeys } from '../view-models/times.ts'
import type { Times } from '../view-models/times.ts'
import {
  catalogueUnavailableCode,
  toStatusPage
} from '../view-models/status-page.ts'
import type { Zone } from '../view-models/zoned-clock.ts'

const cursorMax = 512

/** Bounds a later page's number; real ones are far smaller. */
const pageMax = 10_000

const valueMax = 200

/** Any key that could be a filter: GAS knows which are, and refuses the rest. */
const urlKey = /^[A-Za-z][A-Za-z0-9.]*$/

const urlValue = Joi.string().allow('').max(valueMax)

/** The most values one filter takes, as GAS does. */
const valuesMax = 20

/** A repeated key is a filter with several values. */
const urlValues = Joi.alternatives(
  urlValue,
  Joi.array().items(urlValue).max(valuesMax)
)

type Address = Record<string, string | string[] | undefined>

interface ListUrlQuery extends Address {
  cursor?: string
  searched?: string
  page?: string
  through?: string
  [clearParam]?: string
  [expiredParam]?: string
}

/** Where the address starts in the list: a later page by its cursor, or every page through one. */
interface ListPlace {
  cursor?: string
  searched?: string
  page: number
  through?: number
}

const isLater = ({
  cursor,
  through
}: Pick<ListPlace, 'cursor' | 'through'>): boolean =>
  cursor !== undefined || through !== undefined

const toPlace = ({
  cursor,
  searched,
  page,
  through
}: Pick<
  ListUrlQuery,
  'cursor' | 'searched' | 'page' | 'through'
>): ListPlace => ({
  cursor,
  searched,
  page: cursor ? Number(page ?? 2) : 1,
  through: through === undefined ? undefined : Number(through)
})

/** Hyphenated, so neither can be taken for a fact the form carries beside it. */
const kindField = 'ref-kind'

const valueField = 'ref-value'

interface SearchPayload extends Address {
  [kindField]: string
  [valueField]: string
}

/** A list's path as the catalogue spells one, and as GAS is asked for it. */
const listPathPattern = /^[\w-]+(?:\/[\w-]+)*$/

const listPathMax = 200

const withoutTrailingSlashes = (path: string): string => {
  let end = path.length

  while (path.endsWith('/', end)) {
    end -= 1
  }

  return path.slice(0, end)
}

/** Paths other routes own: pages that are never lists, and what lies below a list's own path. */
const ownedElsewhere = [
  /^(?:explore|clients|times)(?:\/|$)/,
  /^(?:applications|cases|grants|workflows)\//,
  /^events(?:\/[\w-]+)?$/,
  /^events(?:\/[\w-]+){3,}$/
]

const isListPath = (path: string): boolean =>
  path.length <= listPathMax &&
  listPathPattern.test(path) &&
  !ownedElsewhere.some((owned) => owned.test(path))

/** The path below the admin's root, without a trailing slash; null for one no list could have. */
const toListPath = (request: Request): string | null => {
  const path = withoutTrailingSlashes(String(request.params.path ?? ''))

  return isListPath(path) ? path : null
}

/** A list's place, a retired switch, the names a search goes by elsewhere and the list's notice: never carried into a list's URL. */
const uncarriedKeys = new Set([
  'cursor',
  'page',
  'through',
  'searched',
  'clear',
  'audit',
  'q',
  'search',
  'ref',
  'kind',
  expiredParam
])

const isCarried = (key: string): boolean =>
  urlKey.test(key) && !uncarriedKeys.has(key)

/** The facts and range a search form posts beside the search: what its redirect may carry. */
const toPostedAddress = (posted: Address): Address =>
  Object.fromEntries(Object.entries(posted).filter(([key]) => isCarried(key)))

/** The audit switch's key, from links made before audit was one more event type. */
const retiredKeys = ['audit']

/** The list's own URL for an address, from the address alone: what a search is stored against, and where its redirects go. */
const toListHref = (
  path: string,
  address: Address,
  params?: URLSearchParams
): string =>
  toFilterHref(
    `${devOpsPath}/${path}`,
    Object.keys(address).filter((key) => !retiredKeys.includes(key)),
    address,
    params
  )

/**
 * An unset menu or an empty box sends an empty value, which is no filter. The
 * range is kept as the address spells it, days and all, so every link carries
 * it so; it is read as instants.
 */
const toFilters = (bucket: BucketEntry, address: Address): BucketFilters =>
  Object.fromEntries(
    Object.entries(fromUrlQuery(bucket, address)).filter(
      ([, value]) => value?.length
    )
  )

/**
 * A later page, and every page an address restores, reads its first page's
 * pinned start as it is, never back from now. Null for a range that isn't
 * instants, or ends before it starts: GPA's to refuse.
 */
const toWindow = (
  { from, to, range }: Address,
  zone: Zone,
  place: ListPlace,
  now: Date
): ListAsk['window'] => {
  const window = toRangeInstants(
    { from, to, ...(isLater(place) ? {} : { range }) } as TimeRangeQuery,
    zone,
    now
  )

  return isReadableWindow(window) ? window : null
}

const browse: SearchToRun = { q: '', repeat: false, id: '' }

/**
 * A cursor is only a position, so a later page of a search runs the search its
 * first page ran, or none: null when that search is no longer held.
 */
const searchFor = (
  request: Request,
  path: string,
  { cursor, searched, through }: ListPlace,
  listHref: string
): SearchToRun | null => {
  const key = toSearchKey(path)

  if (!isLater({ cursor, through })) {
    return takeSearch(request, key, listHref)
  }

  return searched ? peekSearch(request, key, searched) : browse
}

/** Without the catalogue no list can be drawn: the page says so, and access tokens, which need none, stay in reach. */
const viewCatalogueUnavailable = (request: Request, h: ResponseToolkit) =>
  h
    .view(
      'status',
      toStatusPage(request, catalogueUnavailableCode, 'catalogue')
    )
    .code(catalogueUnavailableCode)

/** A search box that was refused is a 400 whatever the list then read. */
const draw = (
  request: Request,
  h: ResponseToolkit,
  input: Omit<ListPageInput, 'buckets'>
) => {
  const full = {
    ...input,
    buckets: shellCatalogue(request)?.buckets ?? [input.bucket]
  }

  return h
    .view('list', toListPage(full))
    .code(input.attempt ? badRequest : toListStatusCode(full))
}

/** The list footer's loader appends the rows of a page it is answered with, so a page it can't append names where to go instead. */
const isLoadedInPlace = (request: Request): boolean =>
  request.headers['x-requested-with'] === 'gpa-load-more'

/** The in-place loader is answered with a conflict naming the page, so it goes there rather than appending rows read without the search. */
const toFirstPage = (request: Request, h: ResponseToolkit, href: string) =>
  isLoadedInPlace(request)
    ? h.response().code(staleSearchCode).header('location', href)
    : h.redirect(href)

/** The first page, saying the search has expired. */
const viewExpired = (
  request: Request,
  h: ResponseToolkit,
  path: string,
  address: Address
) =>
  toFirstPage(
    request,
    h,
    toListHref(path, address, new URLSearchParams({ [expiredParam]: '1' }))
  )

/** What one list request asks, and how its page is drawn. */
interface PageAsk {
  path: string
  address: Address
  place: ListPlace
  search: SearchToRun
  notice?: ListNotice
  attempt?: SearchAttempt
}

/** What the page is drawn with beside the answer. */
interface Drawing extends PageAsk {
  bucket: BucketEntry
  times: Times
  now: Date
}

/** GAS refused what was asked, so a search held would only fail again. */
const isRefused = ({ read, refusedSearch }: BucketListing): boolean =>
  refusedSearch !== null || read.kind === 'refused'

/** A refused search is shown as cleared, with its reason over the rows read without it. */
const toShown = (
  { read, refusedSearch }: BucketListing,
  search: SearchToRun,
  cursor: string | undefined
): Pick<ListPageInput, 'read' | 'search' | 'cursor' | 'refusal'> => {
  if (refusedSearch === null) {
    return { read, search, cursor }
  }

  return {
    read,
    search: null,
    ...(read.kind === 'read'
      ? { refusal: { kind: 'search', message: refusedSearch.refusal } }
      : {})
  }
}

/**
 * A later page of a search GAS refused answers with its first page without
 * the search: never added under the search's rows, it goes to the first page,
 * which runs the search again and draws the refusal.
 */
const viewListing = (
  request: Request,
  h: ResponseToolkit,
  drawing: Drawing,
  listing: BucketListing
) => {
  const { bucket, path, address, place, search, times, now } = drawing

  if (listing.refusedSearch !== null && place.cursor) {
    return toFirstPage(request, h, toListHref(path, address))
  }

  forgetRefused(request, toSearchKey(path), search, isRefused(listing))

  const filters = toFilters(bucket, address)

  return draw(request, h, {
    bucket,
    filters: isLater(place) ? filters : pinQuickRange(filters, now),
    times,
    page: place.page,
    through: place.through,
    notice: drawing.notice,
    attempt: drawing.attempt,
    pageRows: listing.pageRows,
    stopped: listing.stopped,
    ...toShown(listing, search, place.cursor)
  })
}

/** A refused address shows only what the list could have read: no value its fact doesn't offer. */
const viewRefusedAddress = (
  request: Request,
  h: ResponseToolkit,
  { bucket, address, times, attempt }: Drawing
) =>
  draw(request, h, {
    bucket,
    read: null,
    filters: toFilters(bucket, withOfferedValues(bucket, address)),
    times,
    search: null,
    attempt,
    refusal: { kind: 'address' }
  })

const rangeKeys = new Set(['from', 'to', 'range'])

const withoutRange = (filters: BucketFilters): BucketFilters =>
  Object.fromEntries(
    Object.entries(filters).filter(([key]) => !rangeKeys.has(key))
  )

/** An unreadable range isn't shown as chosen. */
const viewRefusedRange = (
  request: Request,
  h: ResponseToolkit,
  { bucket, address, times, attempt }: Drawing
) =>
  draw(request, h, {
    bucket,
    read: null,
    filters: withoutRange(toFilters(bucket, address)),
    times,
    search: null,
    attempt,
    refusal: { kind: 'range' }
  })

const refusedViews: Record<AddressRefusal, typeof viewRefusedRange> = {
  address: viewRefusedAddress,
  range: viewRefusedRange
}

const viewCaseworkingUnreachable = (
  request: Request,
  h: ResponseToolkit,
  list: CaseworkingList
) =>
  h
    .view(
      'list',
      toCaseworkingUnreachable(
        list,
        `${request.url.pathname}${request.url.search}`
      )
    )
    .code(caseworkingUnreachableCode)

const findEntry = (
  buckets: BucketEntry[],
  id: string | null,
  path: string
): BucketEntry | null =>
  buckets.find((bucket) => bucket.id === id) ??
  buckets.find((bucket) => bucket.path === path) ??
  null

/** The entry GAS named, in the shell its answer carried; by the path asked when it named none. */
const entryOf = (
  request: Request,
  id: string | null,
  path: string
): BucketEntry | null =>
  findEntry(shellCatalogue(request)?.buckets ?? [], id, path)

/** While GAS can't reach CW, a CW list says so, and any other path can't be told from one. */
const viewCwUnreachable = (
  request: Request,
  h: ResponseToolkit,
  path: string
) => {
  const list = toCaseworkingListAt(path)

  return list
    ? viewCaseworkingUnreachable(request, h, list)
    : viewCatalogueUnavailable(request, h)
}

type Answered = Exclude<
  ListOutcome,
  { kind: 'not-found' } | { kind: 'cw-unreachable' }
>

const viewAnswered = (
  request: Request,
  h: ResponseToolkit,
  drawing: Drawing,
  outcome: Answered
) => {
  if (outcome.kind === 'listed') {
    return viewListing(request, h, drawing, outcome.listing)
  }

  if (outcome.kind === 'checked') {
    return viewRefusedRange(request, h, drawing)
  }

  return refusedViews[outcome.refusal](request, h, drawing)
}

/** No list at the path is a 404, and a page drawn from an answer that carried no lists says they couldn't be read. */
const viewOutcome = (
  request: Request,
  h: ResponseToolkit,
  ask: PageAsk,
  outcome: ListOutcome,
  now: Date
) => {
  if (outcome.kind === 'not-found') {
    throw Boom.notFound()
  }

  if (outcome.kind === 'cw-unreachable') {
    return viewCwUnreachable(request, h, ask.path)
  }

  const bucket = entryOf(request, outcome.bucket, ask.path)

  if (bucket === null) {
    return viewCatalogueUnavailable(request, h)
  }

  return viewAnswered(
    request,
    h,
    { ...ask, bucket, times: timesOf(request), now },
    outcome
  )
}

/** One call: GAS finds the list by its path, checks the address and reads it. */
const viewList = async (request: Request, h: ResponseToolkit, ask: PageAsk) => {
  const now = new Date()
  const outcome = await listBucketUseCase({
    path: ask.path,
    address: ask.address,
    window: toWindow(ask.address, timesOf(request).zone, ask.place, now),
    place: ask.place,
    search: ask.search
  })

  return viewOutcome(request, h, ask, outcome, now)
}

const toNotice = (expired: string | undefined): ListNotice | undefined =>
  expired ? 'expired' : undefined

/**
 * Clear all, an old link's retired switch and a later page of a search no
 * longer held are each answered from the address alone, asking GAS nothing.
 */
const viewAddress = (request: Request, h: ResponseToolkit, path: string) => {
  const {
    cursor,
    searched,
    page,
    through,
    [clearParam]: clear,
    [expiredParam]: expired,
    ...address
  } = withoutShellKeys(request.query as ListUrlQuery)
  const listHref = toListHref(path, address)

  if (clear) {
    clearSearch(request, toSearchKey(path))

    return h.redirect(listHref)
  }

  if (retiredKeys.some((key) => key in address)) {
    return h.redirect(listHref)
  }

  const place = toPlace({ cursor, searched, page, through })
  const search = searchFor(request, path, place, listHref)

  if (search === null) {
    return viewExpired(request, h, path, address)
  }

  return viewList(request, h, {
    path,
    address,
    place,
    search,
    notice: toNotice(expired)
  })
}

/**
 * The admin's own root opens its first list, as the catalogue orders them.
 * Found rather than moved permanently, so a browser never caches it past a
 * change of order. No other path is redirected.
 */
export const viewDevOpsRoute: ServerRoute = {
  method: 'GET',
  path: devOpsPath,
  async handler(request: Request, h: ResponseToolkit) {
    await readShellUseCase()

    const home = toHomeHref(shellCatalogue(request))

    return home === null
      ? viewCatalogueUnavailable(request, h)
      : h.redirect(home)
  }
}

/** Every path below the admin's root no other route takes: a list, or a 404. */
const listPath = `${devOpsPath}/{path*}`

const pathOrNotFound = (request: Request): string => {
  const path = toListPath(request)

  if (path === null) {
    throw Boom.notFound()
  }

  return path
}

export const viewBucketRoute: ServerRoute = {
  method: 'GET',
  path: listPath,
  options: {
    cache: listPageCache,
    validate: {
      query: Joi.object({
        cursor: Joi.string().max(cursorMax),
        searched: Joi.string().guid(),
        page: Joi.number().integer().min(2).max(pageMax),
        through: Joi.number().integer().min(1).max(restoreMax),
        [clearParam]: Joi.string().valid('all'),
        [expiredParam]: Joi.string().valid('1'),
        ...timeRangeFilters,
        ...shellQuery
      })
        .pattern(urlKey, urlValues)
        .oxor('cursor', 'through')
        .with('page', 'cursor')
    }
  },
  handler: (request: Request, h: ResponseToolkit) =>
    viewAddress(request, h, pathOrNotFound(request))
}

/** What an empty box clears, or the search a typed value is; null for one that cannot be. */
const toStoredQuery = (kind: string, typed: string): string | null => {
  const value = typed.trim()

  return value === '' ? '' : toSearchQuery(kind, value)
}

/**
 * The search runs nothing: it keeps the identifier out of the URL, and the
 * list it redirects to reads it back, GAS checking its kind and the address
 * there. A value GAS could never take is not stored: any search held is
 * cleared, and the list's first page is drawn without one, with the reason
 * beside the box.
 */
export const searchBucketRoute: ServerRoute = {
  method: 'POST',
  path: listPath,
  options: {
    validate: {
      payload: Joi.object({
        [kindField]: Joi.string().allow('').max(valueMax).default(''),
        [valueField]: Joi.string().allow('').default(''),
        ...timeRangeFilters
      })
        .pattern(urlKey, urlValues)
        .empty(null)
        .default({ [kindField]: '', [valueField]: '' })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const path = pathOrNotFound(request)
    const {
      [kindField]: kind,
      [valueField]: typed,
      ...posted
    } = request.payload as SearchPayload
    const address = toPostedAddress(posted)
    const key = toSearchKey(path)
    const href = toListHref(path, address)
    const q = toStoredQuery(kind, typed)

    if (q === null) {
      clearSearch(request, key)

      return viewList(request, h, {
        path,
        address,
        place: { page: 1 },
        search: browse,
        attempt: { kind, value: typed, error: searchError }
      })
    }

    storeSearch(request, key, q, href)

    return h.redirect(href).code(seeOther)
  }
}
