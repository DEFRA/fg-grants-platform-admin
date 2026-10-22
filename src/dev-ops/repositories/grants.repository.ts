import { getFromGas } from '../../common/gas.ts'
import type { SourceError } from './events.repository.ts'
import type { RecordSectionError, StoredDate } from './record-page.ts'

export interface GrantVersionRef {
  code: string
  version: string
}

export type DefinitionFileType = 'grant' | 'agreement' | 'payment'

export type FetchStatus =
  | 'pending'
  | 'fetched'
  | 'transient_error'
  | 'permanent_error'

/** Whether GAS holds the file, and GAS's own fetch status for it. */
export interface DefinitionFile {
  stored: boolean
  fetchStatus: FetchStatus
}

export interface GrantVersionSummary {
  version: string
  status: 'active' | 'draft'
  receivedAt: string
}

export interface GrantVersionHeader {
  code: string
  version: string
  status: GrantVersionSummary['status']
  receivedAt: string
  /** A file the version has no location for is absent. */
  files: { grant: DefinitionFile } & Partial<
    Record<Exclude<DefinitionFileType, 'grant'>, DefinitionFile>
  >
  /** Newest first. */
  versions: GrantVersionSummary[]
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

/** `PHASE:STAGE:STATUS`. */
type LifecyclePosition = string

interface LifecycleStage {
  code: string
  name: string | null
  statuses: { code: string }[]
}

/** How an application reaches a position: a move, a validFrom entry nothing matches, or from any status. */
export type WayIn = { to: LifecyclePosition; processes: string[] } & (
  | { kind: 'move'; from: LifecyclePosition }
  | { kind: 'unmatched'; code: string }
  | { kind: 'any' }
)

export interface ExternalStatusMapping {
  source: string
  code: string
  /** `PHASE:STAGE`, the stage the application must be in. */
  whileIn: string
  mappedTo: string
  /** Not always a position on the map; null when GAS cannot read `mappedTo`. */
  to: string | null
}

/** What can happen to an application of the grant, as GAS enforces it. */
export interface GrantLifecycle {
  phases: { code: string; name: string | null; stages: LifecycleStage[] }[]
  initialPosition: LifecyclePosition
  amendablePositions: string[]
  waysIn: WayIn[]
  externalMappings: ExternalStatusMapping[]
  claimApproval: { from: LifecyclePosition; to: LifecyclePosition } | null
}

export interface GrantVersionPage {
  header: GrantVersionHeader
  overview?: GrantVersionOverview | null
  /** Null when not stored or too large. */
  definition?: GrantDefinition | null
  /** Null when not stored, or when GAS cannot describe it. */
  lifecycle?: GrantLifecycle | null
  /** Why the stored grant has no lifecycle. */
  problem?: string | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export interface GrantVersions {
  code: string
  /** The newest active version; null when there is none. */
  current: string | null
  versions: GrantVersionSummary[]
}

export type GrantRead = 'overview' | 'definition' | 'phases'

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
