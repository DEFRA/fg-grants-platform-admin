import type { WorkflowVersionRef } from '../use-cases/get-workflow-page.use-case.ts'
import { workflowTabIds } from '../use-cases/workflow-tabs.ts'
import type { RecordType } from './record-type.ts'

const workflowsPath = '/dev-ops/workflows'

const workflowTabLabels: Record<(typeof workflowTabIds)[number], string> = {
  overview: 'Overview',
  phases: 'Phases',
  tasks: 'Tasks',
  pages: 'Pages',
  integrations: 'Integrations',
  events: 'Events',
  raw: 'Raw'
}

export const workflowType: RecordType = {
  listId: 'workflows',
  itemId: 'workflow',
  title: 'Workflow',
  path: workflowsPath,
  source: 'CW',
  showClosed: false,
  linkLabel: 'View workflow',
  tabs: workflowTabIds.map((id) => ({ id, label: workflowTabLabels[id] })),
  view: 'workflow',
  titleParam: 'code'
}

export const toWorkflowHref = ({ code, version }: WorkflowVersionRef): string =>
  `${workflowsPath}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`
