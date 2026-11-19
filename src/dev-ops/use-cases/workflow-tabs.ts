import type {
  WorkflowFileType,
  WorkflowRead
} from '../repositories/workflows.repository.ts'

interface WorkflowTab {
  read: WorkflowRead
  /** The section GAS names when the tab's document is too large, when not the read's own. */
  capped?: WorkflowRead
  /** The file the tab shows; null for a tab that needs none. */
  file: WorkflowFileType | null
}

export const workflowTabs = {
  overview: { read: 'overview', file: null },
  phases: { read: 'phases', capped: 'definition', file: 'workflow' },
  tasks: { read: 'definition', file: 'workflow' },
  pages: { read: 'definition', file: 'workflow' },
  integrations: { read: 'definition', file: 'workflow' },
  raw: { read: 'raw', file: 'workflow' }
} as const satisfies Record<string, WorkflowTab>

export type WorkflowTabId = keyof typeof workflowTabs

export const workflowTabIds = Object.keys(workflowTabs) as WorkflowTabId[]
