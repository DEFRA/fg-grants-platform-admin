import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  ConfigVersions,
  DefinitionFetch,
  DefinitionFile,
  VersionRef,
  VersionSummary
} from './config-versions.ts'
import type { SourceError } from './events.repository.ts'
import type {
  Counterpart,
  RecordSectionError,
  StoredDate
} from './record-page.ts'

export type GrantVersionRef = VersionRef

export type DefinitionFileType = 'grant' | 'agreement' | 'payment'

export interface GrantVersionHeader {
  code: string
  version: string
  status: VersionSummary['status']
  receivedAt: string
  /** A file the version has no location for is absent. */
  files: { grant: DefinitionFile } & Partial<
    Record<Exclude<DefinitionFileType, 'grant'>, DefinitionFile>
  >
  /** Newest first. */
  versions: VersionSummary[]
  /** Null while the workflow link is unknown, and on a tab that does not show it. */
  counterpart: Counterpart
}

/** Each is null while the grant file is not stored. */
export interface GrantVersionOverview {
  description: string | null
  startDate: StoredDate
  adminRole: string | null
  storedBytes: number | null
}

/** The stored grants document, as GAS stores it; each tab adds the keys it reads. */
export interface GrantDefinition {
  code: string
  version: string
}

/** An agreement endpoint process's Service Address: scheme, host and path only; null when GAS has no usable URL for its service (unset or unparseable). */
export interface ProcessAddress {
  process: string
  service: string
  url: string | null
}

interface AgreementTransition {
  target: string
  page?: string
  validation?: { required: unknown[] }
  processes?: string[]
}

interface AgreementPage {
  title: string
  layout?: string
  sections?: { id: string }[]
  components: { component: string }[]
}

type AgreementProcess =
  | {
      type: 'endpoint'
      endpoint: { method: string; service: string; path: string }
      request: { body: Record<string, unknown> }
      output: Record<string, unknown>
    }
  | { type: 'handler' }

/** The stored agreement definition, as stored, typed only where the Agreement tab reads it. */
export interface AgreementDefinition {
  code: string
  agreementNumberPrefix: string
  create: { target: string; application: unknown; processes?: string[] }
  templates?: Record<string, Record<string, unknown>>
  states: Record<
    string,
    {
      page?: string
      processes?: string[]
      on?: Record<string, AgreementTransition>
    }
  >
  pages: Record<string, AgreementPage>
  processDefinitions?: Record<string, AgreementProcess>
}

/** `problem` is why GAS cannot load the definition; then it has no addresses. */
export interface GrantAgreement {
  definition: AgreementDefinition
  addresses: ProcessAddress[]
  problem: string | null
}

export interface GrantVersionPage {
  header: GrantVersionHeader
  overview?: GrantVersionOverview | null
  /** Null when not stored or too large. */
  definition?: GrantDefinition | null
  /** The stored payment definition as stored: never compiled here. Null when not stored or too large. */
  payment?: object | null
  /** Null when not stored or too large. */
  agreement?: GrantAgreement | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export type GrantVersions = ConfigVersions

export type GrantRead = 'overview' | 'definition' | 'agreement' | 'payment'

const grantPath = (code: string) =>
  `/grant-admin/grants/${encodeURIComponent(code)}/versions`

export const findGrantVersionPage = async (
  { code, version }: GrantVersionRef,
  read: GrantRead
): Promise<GrantVersionPage> =>
  getFromGas<GrantVersionPage>(
    `${grantPath(code)}/${encodeURIComponent(version)}/${read}`
  )

export const findGrantVersions = async (code: string): Promise<GrantVersions> =>
  getFromGas<GrantVersions>(grantPath(code))

/** `actor` goes to GAS on `x-actor`, so the audit record names a person. */
export const fetchGrantDefinitions = async (
  { code, version }: GrantVersionRef,
  actor?: string
): Promise<DefinitionFetch<DefinitionFileType>> =>
  postToGas<DefinitionFetch<DefinitionFileType>>(
    `${grantPath(code)}/${encodeURIComponent(version)}/fetch`,
    { actor }
  )
