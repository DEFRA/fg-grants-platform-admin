import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  ConfigVersions,
  DefinitionFetch,
  DefinitionFile,
  VersionRef,
  VersionSummary
} from './config-versions.ts'
import type { SourceError } from './events.repository.ts'
import type { Counterpart, RecordSectionError } from './record-page.ts'

export type WorkflowVersionRef = VersionRef

export type WorkflowFileType = 'workflow'

export interface WorkflowVersionHeader {
  code: string
  version: string
  status: VersionSummary['status']
  receivedAt: string
  files: Record<WorkflowFileType, DefinitionFile>
  /** Newest first. */
  versions: VersionSummary[]
  /** The grant version of the same code and version; read on the Overview alone. */
  counterpart: Counterpart
}

/** Each is null while the workflow is not stored. */
export interface WorkflowVersionOverview {
  schemeName: string | null
  requiredRoles: { allOf: string[]; anyOf: string[] } | null
  storedBytes: number | null
}

export interface StoredEndpoint {
  code: string
  service: string
  path: string
  method: string
}

export interface StoredExternalAction {
  code: string
  name: string
  description?: string
  display: boolean
  endpoint:
    | string
    | {
        code: string
        endpointParams?: Record<string, Record<string, unknown>>
      }
    | null
  target: {
    targetNode: string
    dataType: 'ARRAY' | 'OBJECT'
    position: string | null
    key?: string
    place: 'append'
  } | null
}

export interface StoredBanner {
  title?: { text?: string; type: string }
  summary?: Record<
    string,
    { label: string; text?: string; type: string; format?: string }
  >
}

export interface StoredCaseTab {
  link?: { text?: string; index?: number } | null
  renderIf?: string | null
  /** Each key names what the external action's answer is kept under. */
  action?: Record<string, unknown> | null
  content?: { id?: string; component?: string }[] | null
}

/** The stored workflow as Caseworking reads it at runtime, which is looser than its own schema. */
export interface StoredWorkflow {
  endpoints?: StoredEndpoint[]
  externalActions?: StoredExternalAction[]
  pages?: { cases?: { details?: StoredCaseView } }
}

/** What a caseworker sees of a case in CW: its banner and its tabs. */
export interface StoredCaseView {
  banner?: StoredBanner
  tabs?: Record<string, StoredCaseTab>
}

/** Where an endpoint's service resolves to: scheme, host and path, never its headers. */
export interface ServiceAddress {
  code: string | null
  service: string | null
  /** Null when the service's URL is unset or unparseable. */
  url: string | null
}

export interface WorkflowDefinition {
  workflow: StoredWorkflow
  /** One per endpoint, in `workflow.endpoints` order. */
  addresses: ServiceAddress[]
}

export interface WorkflowVersionPage {
  header: WorkflowVersionHeader
  overview?: WorkflowVersionOverview | null
  /** Null when not stored or too large. */
  definition?: WorkflowDefinition | null
  /** The stored workflow, as Caseworking keeps it; null when not stored or too large. */
  raw?: object | null
  storedBytes?: number | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export type WorkflowVersions = ConfigVersions

export type WorkflowRead = 'overview' | 'definition' | 'raw'

const workflowPath = (code: string) =>
  `/grant-admin/workflows/${encodeURIComponent(code)}/versions`

export const findWorkflowVersionPage = async (
  { code, version }: WorkflowVersionRef,
  read: WorkflowRead
): Promise<WorkflowVersionPage> =>
  getFromGas<WorkflowVersionPage>(
    `${workflowPath(code)}/${encodeURIComponent(version)}/${read}`
  )

export const findWorkflowVersions = async (
  code: string
): Promise<WorkflowVersions> => getFromGas<WorkflowVersions>(workflowPath(code))

/** `actor` goes to GAS on `x-actor`, so the audit record names a person. */
export const fetchWorkflowDefinition = async (
  { code, version }: WorkflowVersionRef,
  actor?: string
): Promise<DefinitionFetch<WorkflowFileType>> =>
  postToGas<DefinitionFetch<WorkflowFileType>>(
    `${workflowPath(code)}/${encodeURIComponent(version)}/fetch`,
    { actor }
  )
