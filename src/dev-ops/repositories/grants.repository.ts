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

/** A template position may stop at the phase or the stage, and then matches every position under it. */
export interface TemplatePosition {
  phase: string
  stage?: string
  status?: string
}

export interface EntitlementField {
  input: boolean
  label?: string
  value?: string | number | boolean
  unitType: 'decimal' | 'string'
  decimalPlaces?: number
  unit?: string
  /** Null is the definition's own "no bound". */
  minValue?: number | null
  maxValue?: number | null
  minLength?: number | null
  maxLength?: number | null
}

export type HelpBlock = { text: string } | { items: string[] }

/** As GAS's domain model normalises it: its defaults are applied, and a key the template has not got is absent. */
export interface EntitlementTemplate {
  claimCode: string
  name: string
  description?: string
  materialised: boolean
  maxEntitlements: number
  availableAt: TemplatePosition[]
  fields?: Record<string, EntitlementField>
  help?: { summary: string; content: HelpBlock[] }
  claim?: {
    claimableAt?: TemplatePosition[]
    limits: { maximumClaims: number; allowsPartialClaims: boolean }
    requiresApproval: boolean
    requiresEvidence: boolean
  }
}

export interface GrantEntitlements {
  entitlementTemplates: EntitlementTemplate[]
  claims: {
    /** Both positions are always full. */
    onClaimApproval?: {
      currentPosition: TemplatePosition
      targetPosition: TemplatePosition
    }
    requiredRoles?: { allOf?: string[]; anyOf?: string[] }
  } | null
  /** The stored payment definition, as stored; null when there is no payment file or it is not stored. */
  payment: object | null
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
  /** The stored payment definition as stored: never compiled here. Null when not stored or too large. */
  payment?: object | null
  /** Null when the grant file is not stored, too large, or refused by GAS's model (each with its section error). */
  entitlements?: GrantEntitlements | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export interface GrantVersions {
  code: string
  /** The newest active version; null when there is none. */
  current: string | null
  versions: GrantVersionSummary[]
}

export type GrantRead =
  | 'overview'
  | 'definition'
  | 'phases'
  | 'entitlements'
  | 'payment'

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
