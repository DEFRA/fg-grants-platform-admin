import Boom from '@hapi/boom'

import { checkExploreQuery, runExplore } from './explore-calls.ts'
import type { ExploreAnswer } from './explore-calls.ts'
import { expired, readPage, toEditor, toPage } from './explore-page.ts'
import type { ExploreAsker, ExplorePageOutcome } from './explore-page.ts'
import {
  defaultQuery,
  findOthersItem,
  findStartingPoint,
  toFoundRecord,
  toListQuery,
  toLookup,
  toQueryText,
  toTooLong
} from './explore-queries.ts'
import type {
  FindOthersItem,
  ListLook,
  RecordLookup
} from './explore-queries.ts'
import type { BucketEntry } from '../repositories/buckets.repository.ts'
import { queryList } from '../repositories/lists.repository.ts'
import type { ListAddress } from './list-bucket.use-case.ts'
import { toGasErrorField } from './gas-status.ts'
import { findRecent, holdRun } from './held-runs.ts'
import { viewWindowUseCase } from './view-explore.use-case.ts'
import type {
  ExploreApart,
  ExploreGone,
  ExploreRestart
} from './view-explore.use-case.ts'

/**
 * Every way into a run:
 * - `typed`: the editor's Run;
 * - `pick`: the Queries menu, a starting point by its slug or a Recent query by its id;
 * - `window`: Keep looking, the run's next window, `inPlace` when the footer's loader appends it;
 * - `list`: a list's Open in Explore, by its path and params; its entry, filters and search are read once GAS names its list;
 * - `find`: a record's Find others, by the record's page.
 */
export type ExploreWayIn =
  | { kind: 'typed'; q: string }
  | { kind: 'pick'; pick: string }
  | { kind: 'window'; run: string; page: number; inPlace: boolean }
  | {
      kind: 'list'
      address: ListAddress
      toList: (bucketId: string) => ExploredList | null
    }
  | { kind: 'find'; find: string; record: string }

/** The list an Open in Explore came from, and what it shows. */
export interface ExploredList {
  bucket: BucketEntry
  look: ListLook
}

/** A run held, to show at its own address: its first window, or the one named. */
export interface ExploreHeld {
  kind: 'held'
  id: string
  page?: number
}

export type ExploreRunOutcome =
  | ExploreHeld
  | ExplorePageOutcome
  | ExploreRestart
  | ExploreGone
  | ExploreApart

type WayIn<K extends ExploreWayIn['kind']> = (
  asker: ExploreAsker,
  wayIn: Extract<ExploreWayIn, { kind: K }>
) => Promise<ExploreRunOutcome>

const toHeld = async (
  { owner }: ExploreAsker,
  q: string
): Promise<ExploreHeld> => ({ kind: 'held', id: await holdRun(owner, q) })

/** Checked before it is held: a query GAS refuses is said at the field, and never run or kept in Recent. */
const runTyped: WayIn<'typed'> = async (asker, wayIn) => {
  const q = toQueryText(wayIn.q)
  const tooLong = toTooLong(q)

  if (tooLong) {
    return readPage(asker, { ...toEditor(q), result: tooLong })
  }

  const { result, vocabulary } = await checkExploreQuery(q)

  return result.outcome === 'failed' && result.failure.kind === 'invalid'
    ? toPage(asker, { ...toEditor(q), result }, vocabulary)
    : toHeld(asker, q)
}

const runPicked: WayIn<'pick'> = async (asker, { pick }) => {
  const q =
    findStartingPoint(pick, new Date())?.q ??
    (await findRecent(asker.owner, pick))

  return q === null ? readPage(asker, expired) : toHeld(asker, q)
}

/** Keep looking without script reads nothing itself: the window's own address reads it. In place, the loader appends this answer, so it is the window. */
const runWindow: WayIn<'window'> = async (asker, { run, page, inPlace }) =>
  inPlace
    ? viewWindowUseCase(asker, { run, page })
    : { kind: 'held', id: run, page }

/** How GAS refused a list's address: no list there, an address or range it can't be, or it couldn't say. */
const toListRefusal = (error: unknown): Boom.Boom => {
  const code = toGasErrorField(error, 'code')

  if (code === 'LIST_NOT_FOUND') {
    return Boom.notFound()
  }

  return code === 'ADDRESS_REFUSED' || code === 'RANGE_REFUSED'
    ? Boom.badRequest()
    : Boom.serverUnavailable()
}

/** GAS finds the list at the address and checks it, reading none of it; the list's id is all it answers. */
const findListAt = async (address: ListAddress): Promise<string> => {
  try {
    return (await queryList({ ...address, search: null, read: false })).bucket
  } catch (error) {
    throw toListRefusal(error)
  }
}

const runFromList: WayIn<'list'> = async (asker, { address, toList }) => {
  const list = toList(await findListAt(address))
  const q = list && toListQuery(list.bucket, list.look)

  if (!q) {
    throw Boom.notFound()
  }

  return toHeld(asker, q)
}

const firstText = (cell: unknown): string | null => {
  const first = [cell ?? []].flat()[0]

  return typeof first === 'string' || typeof first === 'number'
    ? String(first)
    : null
}

/** What the record's business name or SBI is, from the column the lookup put it in. */
const toLookedUp = (
  answer: ExploreAnswer,
  lookup: RecordLookup,
  item: FindOthersItem
): string | null => {
  const column = answer.columns.at(lookup.columns.indexOf(item.by))
  const row = answer.rows.at(0)

  return column && row ? firstText(row.cells[column.key]) : null
}

/** The item and the record a Find others names, or a bad request for either it can't. */
const toFindOthersOf = ({ find, record }: { find: string; record: string }) => {
  const item = findOthersItem(find)
  const found = toFoundRecord(record)

  if (item === null || found === null) {
    throw Boom.badRequest()
  }

  return { item, record: found }
}

/** Reads the record's business name or SBI through Explore, then runs the item's query by it. */
const runFindOthers: WayIn<'find'> = async (asker, wayIn) => {
  const { item, record } = toFindOthersOf(wayIn)
  const lookup = toLookup(record)
  const { result, vocabulary } = await runExplore({ query: lookup.query })

  if (result.outcome === 'failed') {
    return toPage(asker, { ...toEditor(defaultQuery), result }, vocabulary)
  }

  const value = toLookedUp(result.answer, lookup, item)

  return value === null
    ? toPage(
        asker,
        toEditor(defaultQuery, {
          kind: 'no-value',
          noun: record.noun,
          by: item.by
        }),
        vocabulary
      )
    : toHeld(asker, item.toQuery(value))
}

const waysIn: { [K in ExploreWayIn['kind']]: WayIn<K> } = {
  typed: runTyped,
  pick: runPicked,
  window: runWindow,
  list: runFromList,
  find: runFindOthers
}

/** Holds the run a way in names, or says why it can't on the page. */
export const runExploreUseCase = async ({
  owner,
  wayIn
}: ExploreAsker & { wayIn: ExploreWayIn }): Promise<ExploreRunOutcome> =>
  (waysIn[wayIn.kind] as WayIn<ExploreWayIn['kind']>)({ owner }, wayIn)
