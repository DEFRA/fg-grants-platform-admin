import type { Vocabulary } from '../repositories/explore.repository.ts'
import { readExploreVocabulary } from './explore-calls.ts'
import type { Explored } from './explore-calls.ts'

/** The sources and paths this person may query: GAS lists only the sources their roles allow. */
export const getExploreVocabularyUseCase = async ({
  roles
}: {
  roles: string[]
}): Promise<Explored<Vocabulary>> => readExploreVocabulary(roles)
