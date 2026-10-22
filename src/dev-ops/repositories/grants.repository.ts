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
  RecordEvents,
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
  /** Null when not stored or too large. */
  agreement?: GrantAgreement | null
  events?: RecordEvents | null
  /** Null when the grant file is not stored, too large, or refused by GAS's model (each with its section error). */
  entitlements?: GrantEntitlements | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export type GrantVersions = ConfigVersions

export type GrantRead =
  | 'overview'
  | 'definition'
  | 'phases'
  | 'entitlements'
  | 'agreement'
  | 'payment'
  | 'events'

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
