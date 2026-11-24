import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import type {
  ExplorePositions,
  ExploreShow,
  ExploreSource
} from './explore.repository.ts'

/** Whose runs: the session and the signed-in user, so one person's runs are never another's. */
export interface ExploreOwner {
  session: string
  user: string
}

/** One window read: where the next one starts (null at the end), how many rows the run has found up to it, and from what. */
export interface HeldPage {
  positions: ExplorePositions | null
  /** The window reached the source's oldest record. */
  end: boolean
  found: number
  source: ExploreSource
}

/** A query run from Explore: its text lives here, never in a URL. */
export interface HeldRun {
  id: string
  q: string
  heldAt: number
  /** The most windows a restore draws: GAS stopped the one after for too many cells. Kept under its own key, so learning it never writes the run. */
  restorable?: number
  /** Show it: one row of the run `q` is, which every read of this run names beside it. */
  show?: ExploreShow
  /** Show it: the row's number among its run's results. */
  result?: number
}

export interface RecentQuery {
  id: string
  q: string
}

/** The owner's runs, newest first, and its Recent. */
export interface RunIndex {
  runs: string[]
  recent: RecentQuery[]
}

/** How long a run, its windows and Recent are kept from when each was last written. */
const heldForMinutes = 30

export const heldForMs = heldForMinutes * 60 * 1000

interface Store {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown, ttl?: number) => Promise<void>
  drop: (key: string) => Promise<void>
}

/**
 * A cache segment of Explore's own, never the session's store: each run,
 * window and Recent query is a key of its own, so a request that waits on
 * GAS writes back only what it read.
 */
const held: { store: Store | null } = { store: null }

export const provideExploreRunsStore = (server: Server): void => {
  held.store = server.cache({
    cache: config.get('session.cache.name'),
    segment: 'explore',
    expiresIn: heldForMs
  }) as unknown as Store
}

const storeOf = (): Store => {
  if (held.store === null) {
    throw new Error('Explore’s store is not provided')
  }

  return held.store
}

const keyOf = ({ session, user }: ExploreOwner, ...parts: string[]): string =>
  [session, user, ...parts].join(':')

const runKey = (owner: ExploreOwner, id: string) => keyOf(owner, 'run', id)

const read = async <T>(key: string): Promise<T | null> =>
  ((await storeOf().get(key)) as T | null) ?? null

export const findRunIndex = async (owner: ExploreOwner): Promise<RunIndex> =>
  (await read<RunIndex>(keyOf(owner, 'index'))) ?? { runs: [], recent: [] }

export const saveRunIndex = async (
  owner: ExploreOwner,
  index: RunIndex
): Promise<void> => storeOf().set(keyOf(owner, 'index'), index)

const restorableKey = (owner: ExploreOwner, id: string) =>
  `${runKey(owner, id)}:restorable`

/** The run with the limit learnt for it; a limit outlasting its run is never read. */
export const findHeldRun = async (
  owner: ExploreOwner,
  id: string
): Promise<HeldRun | null> => {
  const run = await read<HeldRun>(runKey(owner, id))
  const restorable =
    run === null ? null : await read<number>(restorableKey(owner, id))

  return run === null || restorable === null ? run : { ...run, restorable }
}

export const saveHeldRun = async (
  owner: ExploreOwner,
  run: HeldRun
): Promise<void> => storeOf().set(runKey(owner, run.id), run)

/** Kept no longer than the run it was learnt for. */
export const saveRestorable = async (
  owner: ExploreOwner,
  { id, heldAt }: HeldRun,
  windows: number
): Promise<void> => {
  const ttl = heldAt + heldForMs - Date.now()

  if (ttl > 0) {
    await storeOf().set(restorableKey(owner, id), windows, ttl)
  }
}

export const dropHeldRun = async (
  owner: ExploreOwner,
  id: string
): Promise<void> => {
  await storeOf().drop(runKey(owner, id))
  await storeOf().drop(restorableKey(owner, id))
}

const shownKey = (owner: ExploreOwner, source: string) =>
  `${runKey(owner, source)}:shown`

/** The Show it run held under a run: the one its newest Show it holds. */
export const findShownId = async (
  owner: ExploreOwner,
  source: string
): Promise<string | null> => read<string>(shownKey(owner, source))

export const saveShownId = async (
  owner: ExploreOwner,
  source: string,
  id: string
): Promise<void> => storeOf().set(shownKey(owner, source), id)

export const dropShownId = async (
  owner: ExploreOwner,
  source: string
): Promise<void> => storeOf().drop(shownKey(owner, source))

export const findHeldPage = async (
  owner: ExploreOwner,
  id: string,
  n: number
): Promise<HeldPage | null> =>
  read<HeldPage>(`${runKey(owner, id)}:${String(n)}`)

export const saveHeldPage = async (
  owner: ExploreOwner,
  id: string,
  n: number,
  page: HeldPage
): Promise<void> => storeOf().set(`${runKey(owner, id)}:${String(n)}`, page)

export const findRecentQuery = async (
  owner: ExploreOwner,
  id: string
): Promise<RecentQuery | null> => read<RecentQuery>(keyOf(owner, 'recent', id))

export const saveRecentQuery = async (
  owner: ExploreOwner,
  recent: RecentQuery
): Promise<void> => storeOf().set(keyOf(owner, 'recent', recent.id), recent)
