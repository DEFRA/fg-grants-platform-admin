import { runExplore } from './explore-calls.ts'
import type { ExploreAnswer } from './explore-calls.ts'
import { expired, readPage, toPage } from './explore-page.ts'
import type { ExploreAsker, ExplorePageOutcome } from './explore-page.ts'
import { findFurthestPage, findLiveRun } from './held-runs.ts'
import type { HeldPage } from './held-runs.ts'

export interface ExploreFile {
  kind: 'file'
  answer: ExploreAnswer
}

/** From the top down to the furthest window read, or every window when that one reached the end; a run that read no window reads as it did. */
const toCsvEnd = (furthest: HeldPage | null) => {
  if (furthest === null) {
    return {}
  }

  if (furthest.end) {
    return { untilEnd: true }
  }

  return furthest.positions ? { positions: furthest.positions } : {}
}

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
    query: held.q,
    ...toCsvEnd(await findFurthestPage(owner, run)),
    csv: true
  })

  return result.outcome === 'read'
    ? { kind: 'file', answer: result.answer }
    : toPage(
        { owner },
        {
          q: held.q,
          run: { id: run, page: 1 },
          result,
          previous: null,
          notice: null
        },
        vocabulary
      )
}
