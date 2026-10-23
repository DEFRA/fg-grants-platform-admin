import type { WorkflowVersions } from '../repositories/workflows.repository.ts'
import { findWorkflowVersions } from '../repositories/workflows.repository.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'

export const getWorkflowVersionsUseCase = async (
  code: string
): Promise<RecordResult<WorkflowVersions>> =>
  readRecord('workflow', () => findWorkflowVersions(code), 'WORKFLOW_NOT_FOUND')
