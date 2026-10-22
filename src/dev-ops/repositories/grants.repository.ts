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

/** GAS checks the method on arrival, but not on a lazy S3 load or in versions stored before that check. */
export interface GrantAction {
  name: string
  method: string
  url: string
}

/** The stored grants document, as GAS stores it; each tab adds the keys it reads. */
export interface GrantDefinition {
  code: string
  version: string
  actions: GrantAction[]
}

export interface GrantVersionPage {
  header: GrantVersionHeader
  overview?: GrantVersionOverview | null
  /** Null when not stored or too large. */
  definition?: GrantDefinition | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export type GrantVersions = ConfigVersions

export type GrantRead = 'overview' | 'definition'

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
