import { runExplore } from './explore-calls.ts'
import type { ExploreAnswer } from './explore-calls.ts'
import type { ExploreStop } from '../repositories/explore.repository.ts'
import { defaultQuery } from './explore-queries.ts'
import { expired, readPage, toEditor, toPage } from './explore-page.ts'
import type { ExploreAsker, ExplorePageOutcome } from './explore-page.ts'
import {
  findLiveRun,
  findPage,
  keepPage,
  keepRestorable,
  restoreMax,
  toFound
} from './held-runs.ts'
import type { HeldPage, HeldRun } from './held-runs.ts'

/** A window Explore can't start goes back to the run's first. */
export interface ExploreRestart {
  kind: 'restart'
  id: string
}

/** A restore cut before the window its address asked for: that window on its own page, the one before it held. */
export interface ExploreApart {
  kind: 'apart'
  id: string
  page: number
}

/** Keep looking in place on a run no longer held: the loader goes to the run's page, which says so. */
export interface ExploreGone {
  kind: 'gone'
  id: string
}

/** A window this owner can start: the first, or one after a window read that didn't reach the end. */
const canStart = (page: number, previous: HeldPage | null): boolean =>
  page === 1 || Boolean(previous?.positions)

const toStart = (previous: HeldPage | null) =>
  previous?.positions ? { positions: previous.positions } : {}

/** Where the next window starts: null once this one reached the end. */
const toNextStart = ({ window }: ExploreAnswer) =>
  window && !window.end ? window.positions : null

const findPrevious = (asker: ExploreAsker, id: string, page: number) =>
  page > 1 ? findPage(asker.owner, id, page - 1) : Promise.resolve(null)

/** Keeps where the window read last stopped, and how many rows the run has found through it. */
const keepRead = async (
  { owner }: ExploreAsker,
  held: HeldRun,
  page: number,
  { answer, found }: { answer: ExploreAnswer; found: number }
): Promise<void> =>
  keepPage(owner, held.id, page, {
    positions: toNextStart(answer),
    end: answer.window?.end ?? false,
    found,
    source: answer.source
  })

/** Reads one window from the window before it, and keeps where it stopped. */
const readWindow = async (
  asker: ExploreAsker,
  held: HeldRun,
  page: number,
  previous: HeldPage | null
) => {
  const reply = await runExplore(
    { query: held.q, ...toStart(previous) },
    asker.roles
  )

  if (reply.result.outcome === 'read') {
    const { answer } = reply.result

    await keepRead(asker, held, page, {
      answer,
      found: toFound(previous, answer.rows.length)
    })
  }

  return reply
}

const showRun = async (
  asker: ExploreAsker,
  held: HeldRun,
  page: number,
  previous: HeldPage | null
): Promise<ExplorePageOutcome> => {
  const { result, vocabulary } = await readWindow(asker, held, page, previous)

  return toPage(
    asker,
    {
      q: held.q,
      run: { id: held.id, page, restorable: held.restorable },
      result,
      previous,
      notice: null
    },
    vocabulary
  )
}

const startWindow = async (
  asker: ExploreAsker,
  held: HeldRun,
  page: number
): Promise<ExplorePageOutcome | ExploreRestart> => {
  const previous = await findPrevious(asker, held.id, page)

  return canStart(page, previous)
    ? showRun(asker, held, page, previous)
    : { kind: 'restart', id: held.id }
}

const viewRun = async (
  asker: ExploreAsker,
  id: string,
  page: number
): Promise<ExplorePageOutcome | ExploreRestart> => {
  const held = await findLiveRun(asker.owner, id)

  return held === null
    ? readPage(asker, expired)
    : startWindow(asker, held, page)
}

/** The editor holding the default query, unrun; or one window of a run this owner holds: the first, or the next after one read. */
export const viewExploreUseCase = async ({
  owner,
  roles,
  run,
  page
}: ExploreAsker & {
  run: string | null
  page: number
}): Promise<ExplorePageOutcome | ExploreRestart> =>
  run === null
    ? readPage({ owner, roles }, toEditor(defaultQuery))
    : viewRun({ owner, roles }, run, page)

/** Keep looking in place: the run's next window, or gone when the run is no longer held. */
export const viewWindowUseCase = async (
  asker: ExploreAsker,
  { run, page }: { run: string; page: number }
): Promise<ExplorePageOutcome | ExploreRestart | ExploreGone> => {
  const held = await findLiveRun(asker.owner, run)

  return held === null
    ? { kind: 'gone', id: run }
    : startWindow(asker, held, page)
}

/** The rows each window read, and why the window after the last read failed; the answer without them. */
const toWindowsRead = ({ windowRows, stopped, ...answer }: ExploreAnswer) => ({
  windowRows: windowRows ?? [answer.rows.length],
  stopped: stopped ?? null,
  answer
})

/** GAS stops a restore for too many cells when the next window wouldn't fit in one answer: any restore of more windows stops there too. */
const isTooLarge = (stopped: ExploreStop | null): boolean =>
  stopped?.code === 'TOO_MANY_CELLS'

/** Windows 1 to `windows` in one call: the page shows every row read, the last window read keeps where it stopped. Cut short for too many cells, the window the address asked for opens on its own page instead. */
const restore = async (
  asker: ExploreAsker,
  held: HeldRun,
  windows: number
): Promise<ExplorePageOutcome | ExploreApart> => {
  const { result, vocabulary } = await runExplore(
    { query: held.q, windows },
    asker.roles
  )
  const run = {
    id: held.id,
    page: 1,
    through: windows,
    restorable: held.restorable
  }

  if (result.outcome === 'failed') {
    return toPage(
      asker,
      { q: held.q, run, result, previous: null, notice: null },
      vocabulary
    )
  }

  const { windowRows, stopped, answer } = toWindowsRead(result.answer)
  const page = windowRows.length

  await keepRead(asker, held, page, { answer, found: answer.rows.length })

  if (isTooLarge(stopped)) {
    await keepRestorable(asker.owner, held, page)

    return { kind: 'apart', id: held.id, page: windows }
  }

  return toPage(
    asker,
    {
      q: held.q,
      run: { ...run, page, windowRows, stopped },
      result: { outcome: 'read', answer },
      previous: null,
      notice: null
    },
    vocabulary
  )
}

/**
 * Every window of a run from the first through `through`, at most
 * `restoreMax`, read again as one answer from the top: what Keep looking in
 * place had shown, for a reload or Back. Only windows already reached are
 * read.
 */
export const restoreExploreUseCase = async ({
  owner,
  roles,
  run,
  through
}: ExploreAsker & {
  run: string
  through: number
}): Promise<ExplorePageOutcome | ExploreRestart | ExploreApart> => {
  const asker = { owner, roles }
  const held = await findLiveRun(owner, run)
  const windows = Math.min(through, restoreMax)

  if (held === null) {
    return readPage(asker, expired)
  }

  return canStart(windows, await findPrevious(asker, run, windows))
    ? restore(asker, held, windows)
    : { kind: 'restart', id: run }
}
