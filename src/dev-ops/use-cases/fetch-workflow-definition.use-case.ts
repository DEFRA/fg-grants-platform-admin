import type {
  WorkflowFileType,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'
import { fetchWorkflowDefinition } from '../repositories/workflows.repository.ts'
import { fetchDefinitions } from './definition-fetches.ts'
import type { DefinitionFetchResult } from './definition-fetches.ts'

export const fetchWorkflowDefinitionUseCase = async (
  ref: WorkflowVersionRef,
  actor?: string
): Promise<DefinitionFetchResult<WorkflowFileType>> =>
  fetchDefinitions(`workflow ${ref.code}@${ref.version}`, () =>
    fetchWorkflowDefinition(ref, actor)
  )
