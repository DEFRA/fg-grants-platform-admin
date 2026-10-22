import type {
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'
import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'
import { workflowTabs } from './workflow-tabs.ts'
import type { WorkflowTabId } from './workflow-tabs.ts'

export type {
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowVersionOverview,
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'

export const getWorkflowPageUseCase = async (
  ref: WorkflowVersionRef,
  tab: WorkflowTabId
): Promise<RecordResult<WorkflowVersionPage>> =>
  readRecord(
    'workflow version',
    () => findWorkflowVersionPage(ref, workflowTabs[tab].read),
    'WORKFLOW_VERSION_NOT_FOUND'
  )
