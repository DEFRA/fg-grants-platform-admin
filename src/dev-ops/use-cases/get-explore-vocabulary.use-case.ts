import type { Vocabulary } from '../repositories/explore.repository.ts'
import { readExploreVocabulary } from './explore-calls.ts'
import type { Explored } from './explore-calls.ts'

/** The sources and paths a query may read. */
export const getExploreVocabularyUseCase = async (): Promise<
  Explored<Vocabulary>
> => readExploreVocabulary()
