import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { BucketResult } from '../repositories/buckets.repository.ts'
import type {
  ListPages,
  ListQuery,
  ListStopped
} from '../repositories/lists.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import {
  toAnsweredFailure,
  toGasErrorField,
  toGasStatusCode
} from './gas-status.ts'
import type { ListResult } from './record-reads.ts'
import { toFailedList } from './record-reads.ts'

/** What a list page asks: its URL's query without its place, its range as instants, where it starts, and the search held. */
export interface ListAsk {
  /** The catalogue entry's `path`, as `events/gas/outbox`. */
  path: string
  address: Record<string, string | string[] | undefined>
  /** Null when the range can't be read as instants: GAS then checks the address and reads nothing. */
  window: { from?: string; to?: string } | null
  /** A later page by its cursor, or every page through one. */
  place: { cursor?: string; through?: number }
  /** An empty `q` is a browse; `repeat` when the last first page shown was this one. */
  search: { q: string; repeat: boolean }
}

/** Keys of a list's URL that are its range or its place, or a retired switch: never a fact. */
const reservedKeys = new Set([
  'from',
  'to',
  'range',
  'cursor',
  'page',
  'through',
  'searched',
  'clear',
  'audit'
])

/** Where a list is, as its address spells it, with its range as instants: what GAS finds and checks it by. */
export type ListAddress = Pick<ListQuery, 'path' | 'params' | 'from' | 'to'>

/** The list's path and its address's facts as typed, for GAS to read and check. */
export const toListAddress = (
  path: string,
  address: ListAsk['address']
): Pick<ListAddress, 'path' | 'params'> => ({
  path,
  params: Object.fromEntries(
    Object.entries(address).filter(
      (entry): entry is [string, string | string[]] =>
        !reservedKeys.has(entry[0]) && entry[1] !== undefined
    )
  )
})

/** Only a first page is counted. */
const toPlaceFields = ({ cursor, through }: ListAsk['place']) => ({
  ...(cursor ? { cursor } : {}),
  ...(through ? { pages: through } : {}),
  count: cursor === undefined
})

/** Every page an address restores was shown before. */
const toListQuery = ({
  path,
  address,
  window,
  place,
  search
}: ListAsk): ListQuery => ({
  ...toListAddress(path, address),
  search: search.q || null,
  ...(window ?? { read: false }),
  ...toPlaceFields(place),
  repeat: search.repeat || place.through !== undefined
})

export type BucketListResult = ListResult<BucketResult>

/** A later page that couldn't be read, by the cursor it starts at. */
export interface StoppedPage {
  cursor: string
  read: Exclude<BucketListResult, { kind: 'read' }>
}

/** Every page read, drawn as one: how many rows each gave, and a later page that couldn't be read. */
export interface BucketListing {
  read: BucketListResult
  /** GAS refused the search, so `read` is the list's first page without it. */
  refusedSearch: { refusal: string | null } | null
  pageRows: number[]
  stopped: StoppedPage | null
}

export type AddressRefusal = 'address' | 'range'

/**
 * What GAS made of a list's address. `bucket` is the entry's id, null when
 * the answer named none, so the page finds its entry by the path asked.
 */
export type ListOutcome =
  | { kind: 'listed'; bucket: string | null; listing: BucketListing }
  /** GAS checked the address and read nothing: the range couldn't be read as instants. */
  | { kind: 'checked'; bucket: string }
  | { kind: 'refused'; bucket: string | null; refusal: AddressRefusal }
  | { kind: 'not-found' }
  /** No list is at the path while GAS can't reach CW, whose lists it may be. */
  | { kind: 'cw-unreachable' }

const toStoppedRead = ({
  statusCode,
  code
}: ListStopped): StoppedPage['read'] =>
  statusCode === statusCodes.badRequest
    ? { kind: 'refused', refusal: null }
    : { kind: 'failed', failure: toAnsweredFailure(statusCode, code) }

const toListing = ({
  pageRows,
  stopped,
  refusedSearch,
  ...page
}: ListPages): BucketListing => ({
  read: { kind: 'read', page },
  refusedSearch,
  pageRows,
  stopped: stopped && { cursor: stopped.cursor, read: toStoppedRead(stopped) }
})

const addressRefusals: Record<string, AddressRefusal> = {
  ADDRESS_REFUSED: 'address',
  RANGE_REFUSED: 'range'
}

const toRefused = (error: unknown): ListOutcome | null => {
  const refusal = addressRefusals[toGasErrorField(error, 'code') ?? '']

  return toGasStatusCode(error) === statusCodes.badRequest && refusal
    ? { kind: 'refused', bucket: toGasErrorField(error, 'bucket'), refusal }
    : null
}

/** GAS's answers for a path it has no list at, by the code each carries. */
const missingLists: Record<
  string,
  { statusCode: number; outcome: ListOutcome }
> = {
  LIST_NOT_FOUND: {
    statusCode: statusCodes.notFound,
    outcome: { kind: 'not-found' }
  },
  CW_UNREACHABLE: {
    statusCode: statusCodes.serviceUnavailable,
    outcome: { kind: 'cw-unreachable' }
  }
}

const toMissing = (error: unknown): ListOutcome | null => {
  const missing = missingLists[toGasErrorField(error, 'code') ?? '']

  return missing?.statusCode === toGasStatusCode(error) ? missing.outcome : null
}

const toFailed = (error: unknown, path: string): ListOutcome => ({
  kind: 'listed',
  bucket: null,
  listing: {
    read: toFailedList(error, `list at ${path}`),
    refusedSearch: null,
    pageRows: [],
    stopped: null
  }
})

const toOutcome = (error: unknown, path: string): ListOutcome => {
  const outcome = toRefused(error) ?? toMissing(error)

  if (outcome === null) {
    return toFailed(error, path)
  }

  logger.info(
    `fg-gas-backend did not read the list at ${path}: ${outcome.kind}`
  )

  return outcome
}

/** One call: GAS finds the list at the path, checks the address, and reads every page asked for. */
export const listBucketUseCase = async (ask: ListAsk): Promise<ListOutcome> => {
  try {
    const { bucket, list } = await queryList(toListQuery(ask))

    return list === null
      ? { kind: 'checked', bucket }
      : { kind: 'listed', bucket, listing: toListing(list) }
  } catch (error) {
    return toOutcome(error, ask.path)
  }
}
