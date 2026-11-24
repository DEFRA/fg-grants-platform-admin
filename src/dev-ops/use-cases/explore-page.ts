import type {
  ExploreStop,
  Vocabulary
} from '../repositories/explore.repository.ts'
import type { ExploreAnswer, Explored } from './explore-calls.ts'
import type { FindBy, FoundRecord } from './explore-queries.ts'
import { getExploreVocabularyUseCase } from './get-explore-vocabulary.use-case.ts'
import { recentQueries } from './held-runs.ts'
import type { ExploreOwner, HeldPage, RecentQuery } from './held-runs.ts'

/** How a run's results are shown: a cell a value, or each row's document as stored. */
export type ExploreView = 'table' | 'documents'

/** What Documents asks GAS to print: each record's start, or a Show it run's one document whole. */
const documentsAsked = (shown: boolean) =>
  shown ? { documents: true } : { starts: true }

/** Only Documents asks GAS for what it prints. */
export const toDocumentsAsked = (view: ExploreView, shown: boolean) =>
  view === 'documents' ? documentsAsked(shown) : {}

/** Said in place of a run: nothing was read for it. */
export type ExploreNotice =
  | { kind: 'expired' }
  | { kind: 'no-value'; noun: FoundRecord['noun']; by: FindBy }

/** What the page shows: the editor's text, and the run, what it read and the window before it. */
export interface ExploreShown {
  q: string
  /** `through`: the page draws every window from the first through it, the last read being `page`, each with `windowRows` of its rows; `stopped`, why the window after `page` couldn't be read. */
  run: {
    id: string
    page: number
    through?: number
    windowRows?: number[]
    stopped?: ExploreStop | null
    /** The most windows a restore of the run draws, when GAS has found fewer than a restore's most. */
    restorable?: number
    view?: ExploreView
    /** A Show it run: the number of the one row of the query it shows, found again by its record's `_id`. */
    shown?: number
  } | null
  result: Explored<ExploreAnswer> | null
  /** The window before the one shown, as read; null for the first. */
  previous: HeldPage | null
  notice: ExploreNotice | null
  /** With no run, the view the editor's Run lands in. */
  view?: ExploreView
}

export interface ExplorePageData extends ExploreShown {
  recent: RecentQuery[]
  /** Null when GAS can't say. */
  vocabulary: Vocabulary | null
}

export interface ExplorePageOutcome {
  kind: 'page'
  page: ExplorePageData
}

/** Who is asking: whose runs. */
export interface ExploreAsker {
  owner: ExploreOwner
}

export const toEditor = (
  q: string,
  notice: ExploreNotice | null = null,
  view: ExploreView = 'table'
): ExploreShown => ({
  q,
  run: null,
  result: null,
  previous: null,
  notice,
  view
})

export const expired: ExploreShown = toEditor('', { kind: 'expired' })

/** The page around what it shows: this owner's Recent, and the vocabulary that came with the request's one call. */
export const toPage = async (
  { owner }: ExploreAsker,
  shown: ExploreShown,
  vocabulary: Vocabulary | null
): Promise<ExplorePageOutcome> => ({
  kind: 'page',
  page: { ...shown, recent: await recentQueries(owner), vocabulary }
})

/** A page that runs nothing: its one call reads the vocabulary. */
export const readPage = async (
  asker: ExploreAsker,
  shown: ExploreShown
): Promise<ExplorePageOutcome> => {
  const vocabulary = await getExploreVocabularyUseCase()

  return toPage(
    asker,
    shown,
    vocabulary.outcome === 'read' ? vocabulary.answer : null
  )
}
