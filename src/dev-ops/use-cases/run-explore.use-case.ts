import Boom from '@hapi/boom'
import { BSON } from 'bson'

import { checkExploreQuery, runExplore } from './explore-calls.ts'
import type { ExploreAnswer, Explored } from './explore-calls.ts'
import { expired, readPage, toEditor, toPage } from './explore-page.ts'
import type {
  ExploreAsker,
  ExplorePageOutcome,
  ExploreView
} from './explore-page.ts'
import {
  defaultQuery,
  findOthersItem,
  findExample,
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
import { findLiveRun, findRecent, holdRun, holdShown } from './held-runs.ts'
import type { ExploreShow } from '../repositories/explore.repository.ts'
import { viewWindowUseCase } from './view-explore.use-case.ts'
import type {
  ExploreApart,
  ExploreGone,
  ExploreRestart
} from './view-explore.use-case.ts'

/**
 * Every way into a run:
 * - `typed`: the editor's Run, landing in the view the editor was in;
 * - `pick`: the Queries menu, an example by its slug or a Recent query by its id, as the editor's Run;
 * - `window`: Keep looking, the run's next window, `inPlace` when the footer's loader appends it;
 * - `list`: a list's Open in Explore, by its path and params; its entry, filters and search are read once GAS names its list;
 * - `find`: a record's Find others, by the record's page;
 * - `show`: Show it, one row of a run this owner holds, by its record's `_id`, its unwound places and an event's box;
 * - `open`: the same row opened in place, read now and held nowhere.
 */
export type ExploreWayIn =
  | { kind: 'typed'; q: string; view?: ExploreView }
  | { kind: 'pick'; pick: string; view?: ExploreView }
  | {
      kind: 'window'
      run: string
      page: number
      inPlace: boolean
      view: ExploreView
    }
  | {
      kind: 'list'
      address: ListAddress
      toList: (bucketId: string) => ExploredList | null
    }
  | { kind: 'find'; find: string; record: string }
  | { kind: 'show' | 'open'; run: string; show: ExploreShow; result: number }

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
  view?: ExploreView
}

/** A row opened in place: what reading it again found, or null when its run is no longer held. */
export interface ExploreOpened {
  kind: 'opened'
  run: string
  show: ExploreShow
  result: number
  read: Explored<ExploreAnswer> | null
}

export type ExploreRunOutcome =
  | ExploreHeld
  | ExploreOpened
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
  q: string,
  view: ExploreView = 'table'
): Promise<ExploreHeld> => ({
  kind: 'held',
  id: await holdRun(owner, q),
  view
})

/** Checked before it is held: a query GAS refuses is said at the field, and never run or kept in Recent. */
const runTyped: WayIn<'typed'> = async (asker, wayIn) => {
  const q = toQueryText(wayIn.q)
  const tooLong = toTooLong(q)
  const editor = toEditor(q, null, wayIn.view)

  if (tooLong) {
    return readPage(asker, { ...editor, result: tooLong })
  }

  const { result, vocabulary } = await checkExploreQuery(q)

  return result.outcome === 'failed' && result.failure.kind === 'invalid'
    ? toPage(asker, { ...editor, result }, vocabulary)
    : toHeld(asker, q, wayIn.view)
}

const runPicked: WayIn<'pick'> = async (asker, { pick, view }) => {
  const q =
    findExample(pick, new Date())?.q ?? (await findRecent(asker.owner, pick))

  return q === null ? readPage(asker, expired) : toHeld(asker, q, view)
}

/** Keep looking without script reads nothing itself: the window's own address reads it. In place, the loader appends this answer, so it is the window. */
const runWindow: WayIn<'window'> = async (
  asker,
  { run, page, inPlace, view }
) =>
  inPlace
    ? viewWindowUseCase(asker, { run, page, view })
    : { kind: 'held', id: run, page, view }

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

const { parseToElements } = BSON.onDemand

const keysOf = (bytes: Uint8Array): string[] =>
  Array.from(parseToElements(bytes), ([, at, length]) =>
    Buffer.from(bytes.subarray(at, at + length)).toString('utf8')
  )

/** Base64 BSON of a document whose one key is `_id`, as a row's id is. */
const isIdDocument = (id: string): boolean => {
  try {
    const keys = keysOf(Buffer.from(id, 'base64'))

    return keys.length === 1 && keys[0] === '_id'
  } catch {
    return false
  }
}

const checkShown = (show: ExploreShow): void => {
  if (!isIdDocument(show.id)) {
    throw Boom.badRequest()
  }
}

/** One row of a run held as a run of its own under it, to show in Documents; the row's GAS reads by what Show it names, asking nothing now. An id that isn't a record's `{ _id }` is a bad request. */
const runShow: WayIn<'show'> = async (asker, { run, show, result }) => {
  checkShown(show)

  const held = await findLiveRun(asker.owner, run)

  return held === null
    ? readPage(asker, expired)
    : {
        kind: 'held',
        id: await holdShown(asker.owner, held, { show, result }),
        view: 'documents'
      }
}

/** One row of a run read again now, as its Show it run's page reads it, its document whole; nothing is held or kept. */
const runOpen: WayIn<'open'> = async ({ owner }, { run, show, result }) => {
  checkShown(show)

  const held = await findLiveRun(owner, run)
  const opened = { kind: 'opened' as const, run, show, result }

  if (held === null) {
    return { ...opened, read: null }
  }

  const reply = await runExplore({ query: held.q, show, documents: true })

  return { ...opened, read: reply.result }
}

const waysIn: { [K in ExploreWayIn['kind']]: WayIn<K> } = {
  typed: runTyped,
  pick: runPicked,
  window: runWindow,
  list: runFromList,
  find: runFindOthers,
  show: runShow,
  open: runOpen
}

/** Holds the run a way in names, or says why it can't on the page. */
export const runExploreUseCase = async ({
  owner,
  wayIn
}: ExploreAsker & { wayIn: ExploreWayIn }): Promise<ExploreRunOutcome> =>
  (waysIn[wayIn.kind] as WayIn<ExploreWayIn['kind']>)({ owner }, wayIn)
