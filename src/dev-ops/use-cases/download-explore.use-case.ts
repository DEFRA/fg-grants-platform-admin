import { runExplore, streamExplore } from './explore-calls.ts'
import type { ExploreAnswer } from './explore-calls.ts'
import type {
  ExploreShow,
  ExploreStream
} from '../repositories/explore.repository.ts'
import { expired, readPage, toPage } from './explore-page.ts'
import type { ExploreAsker, ExplorePageOutcome } from './explore-page.ts'
import { findFurthestPage, findLiveRun, toAsked, toShown } from './held-runs.ts'
import type { HeldPage, HeldRun } from './held-runs.ts'

export interface ExploreFile {
  kind: 'file'
  answer: ExploreAnswer
}

/** From the top down to the furthest window read, or every window when that one reached the end; a run that read no window reads as it did. */
const toFurthest = (furthest: HeldPage | null) => {
  if (furthest === null) {
    return {}
  }

  if (furthest.end) {
    return { untilEnd: true }
  }

  return furthest.positions ? { positions: furthest.positions } : {}
}

/** How far a download reads; a Show it run reads its one row by itself. */
const toCsvEnd = (furthest: HeldPage | null, { show }: HeldRun) =>
  show ? {} : toFurthest(furthest)

/** The run's rows from the top to the furthest window read in any tab, read again as their own query. */
export const downloadExploreUseCase = async ({
  owner,
  run
}: ExploreAsker & { run: string }): Promise<
  ExploreFile | ExplorePageOutcome
> => {
  const held = await findLiveRun(owner, run)

  if (held === null) {
    return readPage({ owner }, expired)
  }

  const { result, vocabulary } = await runExplore({
    ...toAsked(held),
    ...toCsvEnd(await findFurthestPage(owner, run), held),
    csv: true
  })

  return result.outcome === 'read'
    ? { kind: 'file', answer: result.answer }
    : toPage(
        { owner },
        {
          q: held.q,
          run: { id: run, page: 1, ...toShown(held) },
          result,
          previous: null,
          notice: null
        },
        vocabulary
      )
}

/** Download JSON once GAS has said it will answer: its header, and its rows and end, read as they come. */
export interface ExploreLines extends ExploreStream {
  kind: 'lines'
  /** A Show it run's row, which the file names when its record is gone. */
  show: ExploreShow | null
}

/** The run's documents from the top to the furthest window read, each whole as stored, as GAS streams them: one call, its lines read as they come. A download GAS refused or couldn't send says so on the run's page, in Documents. */
export const downloadJsonUseCase = async ({
  owner,
  run
}: ExploreAsker & { run: string }): Promise<
  ExploreLines | ExplorePageOutcome
> => {
  const held = await findLiveRun(owner, run)

  if (held === null) {
    return readPage({ owner }, expired)
  }

  const { result, vocabulary } = await streamExplore({
    ...toAsked(held),
    ...toCsvEnd(await findFurthestPage(owner, run), held)
  })

  return result.outcome === 'read'
    ? { kind: 'lines', ...result.answer, show: held.show ?? null }
    : toPage(
        { owner },
        {
          q: held.q,
          run: { id: held.id, page: 1, view: 'documents', ...toShown(held) },
          result,
          previous: null,
          notice: null
        },
        vocabulary
      )
}
