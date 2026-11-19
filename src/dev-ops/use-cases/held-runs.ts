import { createHash, randomUUID } from 'node:crypto'

import {
  dropHeldRun,
  findHeldPage,
  findHeldRun,
  findRecentQuery,
  findRunIndex,
  heldForMs,
  saveHeldPage,
  saveHeldRun,
  saveRecentQuery,
  saveRestorable,
  saveRunIndex
} from '../repositories/explore-runs.repository.ts'
import type {
  ExploreOwner,
  HeldPage,
  HeldRun,
  RecentQuery
} from '../repositories/explore-runs.repository.ts'

export type {
  ExploreOwner,
  HeldPage,
  HeldRun,
  RecentQuery
} from '../repositories/explore-runs.repository.ts'

const runsMax = 10

const recentMax = 6

/** The most windows one run reads. */
export const pageMax = 1000

/** The most windows a reload or Back reads again, as GAS reads in one answer. */
export const restoreMax = 50

/** One text is one Recent query, under the same id in every tab, however often it runs. */
const recentIdLength = 22

const toRecentId = (q: string): string =>
  createHash('sha256').update(q).digest('base64url').slice(0, recentIdLength)

/**
 * The cache can't compare and set, so the index two Runs write at once may
 * keep only one of them. It only orders the Queries menu and lets the
 * oldest runs go: each run and Recent query is found by its own key, so a
 * run or a pick never expires for it.
 */
export const holdRun = async (
  owner: ExploreOwner,
  q: string
): Promise<string> => {
  const run: HeldRun = { id: randomUUID(), q, heldAt: Date.now() }
  const recent: RecentQuery = { id: toRecentId(q), q }

  await saveHeldRun(owner, run)
  await saveRecentQuery(owner, recent)

  const index = await findRunIndex(owner)
  const runs = [run.id, ...index.runs]

  await saveRunIndex(owner, {
    runs: runs.slice(0, runsMax),
    recent: [
      recent,
      ...index.recent.filter(({ id }) => id !== recent.id)
    ].slice(0, recentMax)
  })
  await Promise.all(runs.slice(runsMax).map((id) => dropHeldRun(owner, id)))

  return run.id
}

const isLive = (run: HeldRun | null): run is HeldRun =>
  run !== null && Date.now() - run.heldAt <= heldForMs

const runId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The run held under the id, or null for one never held, no longer held, or not a run's id at all. */
export const findLiveRun = async (
  owner: ExploreOwner,
  id: string
): Promise<HeldRun | null> => {
  const run = runId.test(id) ? await findHeldRun(owner, id) : null

  return isLive(run) ? run : null
}

export const keepPage = async (
  owner: ExploreOwner,
  id: string,
  n: number,
  page: HeldPage
): Promise<void> => saveHeldPage(owner, id, n, page)

export const findPage = findHeldPage

/** A restore of the run can draw no more windows than these, so a later window is drawn on its own. The run itself is never written, so one let go meanwhile stays gone. */
export const keepRestorable = async (
  owner: ExploreOwner,
  run: HeldRun,
  windows: number
): Promise<void> => saveRestorable(owner, run, windows)

const furthestFrom = async (
  owner: ExploreOwner,
  id: string,
  n: number,
  last: HeldPage | null
): Promise<HeldPage | null> => {
  const page = n <= pageMax ? await findHeldPage(owner, id, n) : null

  return page === null ? last : furthestFrom(owner, id, n + 1, page)
}

/**
 * The furthest window read, in any tab. A window is read only after the one
 * before it, and each is kept at least as long as its run, so they run
 * unbroken from the first.
 */
export const findFurthestPage = async (
  owner: ExploreOwner,
  id: string
): Promise<HeldPage | null> => furthestFrom(owner, id, 1, null)

export const recentQueries = async (
  owner: ExploreOwner
): Promise<RecentQuery[]> => (await findRunIndex(owner)).recent

/** A Recent query by its id: as listed, or under its own key when the index lost it. */
export const findRecent = async (
  owner: ExploreOwner,
  id: string
): Promise<string | null> => {
  const listed = (await findRunIndex(owner)).recent.find(
    (listedQuery) => listedQuery.id === id
  )
  const recent = listed ?? (await findRecentQuery(owner, id))

  return recent?.q ?? null
}

/** How many rows a run has found up to this window. */
export const toFound = (previous: HeldPage | null, rows: number): number =>
  (previous?.found ?? 0) + rows
