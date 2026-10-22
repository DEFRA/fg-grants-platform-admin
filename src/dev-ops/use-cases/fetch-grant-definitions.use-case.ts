import type {
  DefinitionFileType,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { fetchGrantDefinitions } from '../repositories/grants.repository.ts'
import { fetchDefinitions } from './definition-fetches.ts'
import type { DefinitionFetchResult } from './definition-fetches.ts'

export const fetchGrantDefinitionsUseCase = async (
  ref: GrantVersionRef,
  actor?: string
): Promise<DefinitionFetchResult<DefinitionFileType>> =>
  fetchDefinitions(`grant ${ref.code}@${ref.version}`, () =>
    fetchGrantDefinitions(ref, actor)
  )
