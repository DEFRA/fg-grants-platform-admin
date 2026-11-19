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
  GrantStatusMap,
  ServiceAddress,
  StoredAction,
  StoredBanner,
  StoredCaseTab,
  StoredCaseView,
  StoredEndpoint,
  StoredExternalAction,
  StoredInput,
  StoredLabel,
  StoredTask,
  StoredTaskGroup,
  StoredTransition,
  StoredValueOption,
  StoredWorkflow,
  StoredWorkflowPhase,
  StoredWorkflowStage,
  StoredWorkflowStatus,
  WorkflowDefinition,
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowVersionOverview,
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../repositories/workflows.repository.ts'
export type {
  ExternalStatusMapping,
  GrantLifecycle,
  ProcessEffect
} from '../repositories/grants.repository.ts'

export type WorkflowPage = WorkflowVersionPage

/** Overview's answer carries the version's events, and Phases' its grant's status map. */
export const getWorkflowPageUseCase = async (
  ref: WorkflowVersionRef,
  tab: WorkflowTabId
): Promise<RecordResult<WorkflowPage>> =>
  readRecord(
    'workflow version',
    () => findWorkflowVersionPage(ref, workflowTabs[tab].read),
    'WORKFLOW_VERSION_NOT_FOUND'
  )
