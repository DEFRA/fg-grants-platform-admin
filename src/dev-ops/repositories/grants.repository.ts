import { getFromGas, postToGas } from '../../common/gas.ts'
import type {
  ConfigVersions,
  DefinitionFetch,
  DefinitionFile,
  VersionRef,
  VersionSummary
} from './config-versions.ts'
import type { SourceError } from './events.repository.ts'
import type { RecordSectionError, StoredDate } from './record-page.ts'

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
  /** Where its files are in S3; older backends leave it out. */
  s3Bucket?: string | null
  /** Newest first. */
  versions: VersionSummary[]
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
  validation?: {
    required: {
      name?: unknown
      value?: unknown
      href?: unknown
      message?: unknown
    }[]
  }
  processes?: string[]
  /** What the move writes to the agreement. */
  values?: Record<string, unknown>
}

/** A page component, as stored: only the keys the tab walks are typed. */
export interface AgreementComponent {
  component: string
  [key: string]: unknown
}

interface AgreementPage {
  title: string
  layout?: string
  contents?: boolean
  print?: boolean
  watermarks?: Record<string, string>
  backLink?: { text?: string; href?: unknown }
  sections?: {
    id: string
    condition?: string
    components?: AgreementComponent[]
  }[]
  components: AgreementComponent[]
}

interface AgreementEndpoint {
  method: string
  service: string
  path: string
}

type AgreementProcess =
  | {
      type: 'endpoint'
      endpoint: AgreementEndpoint
      request: { body: Record<string, unknown> }
      output: Record<string, unknown>
    }
  | { type: 'handler' }

/** The stored agreement definition, as stored, typed only where the Agreement tab reads it. */
export interface AgreementDefinition {
  code: string
  agreementNumberPrefix: string
  create: {
    target: string
    application: unknown
    processes?: string[]
    values?: Record<string, unknown>
  }
  /** Each text template is a key under a group, with the components it draws. */
  templates?: Record<
    string,
    Record<string, { content?: AgreementComponent[] } | unknown>
  >
  endpoints?: ({ code: string } & AgreementEndpoint)[]
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

/** A root endpoint's Service Address; null when the environment has no URL for its service. */
export interface EndpointAddress {
  code: string
  service: string
  url: string | null
}

/** `problem` is why GAS cannot load the definition; then it has no addresses. */
export interface GrantAgreement {
  definition: AgreementDefinition
  addresses: ProcessAddress[]
  problem: string | null
  /** The `{SERVICE}_URL` names GAS would find unset on loading it; absent from an older GAS. */
  missingServiceUrls?: string[]
  /** Absent from an older GAS; empty when `problem` is set. */
  endpointAddresses?: EndpointAddress[]
}

/** `PHASE:STAGE:STATUS`. */
type LifecyclePosition = string

interface LifecycleStage {
  code: string
  name: string | null
  /** `name` is absent from an older GAS, and null when the definition gives none. */
  statuses: { code: string; name?: string | null }[]
}

/** What one GAS process does on a move, as GAS's own process registry declares it. */
export interface ProcessEffect {
  process: string
  /** The status GAS then sets itself, in the move target's stage. */
  setsStatus: string | null
  tellsCw: boolean
  /** When it does so, in GAS's words; null when always. */
  onlyWhen: string | null
}

/** How a `validFrom` entry matched: as a full position, or as a bare status code in any stage of any phase. */
export type MatchedBy = 'position' | 'status'

/** How an application reaches a position: a move, a validFrom entry nothing matches, or from any status. `processEffects` and `matchedBy` are absent from an older GAS. */
export type WayIn = {
  to: LifecyclePosition
  processes: string[]
  processEffects?: ProcessEffect[]
} & (
  | { kind: 'move'; from: LifecyclePosition; matchedBy?: MatchedBy }
  | { kind: 'unmatched'; code: string; matchedBy?: MatchedBy }
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
  amendablePositions: LifecyclePosition[]
  waysIn: WayIn[]
  externalMappings: ExternalStatusMapping[]
  /** `tellsCw` is absent from an older GAS. */
  claimApproval: {
    from: LifecyclePosition
    to: LifecyclePosition
    tellsCw?: boolean
  } | null
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
  payment: Record<string, unknown> | null
  /** Each named status of the stored grant, by its full position; an older GAS leaves it out. */
  statusNames?: Record<string, string>
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
  payment?: Record<string, unknown> | null
  /** Null when not stored or too large. */
  agreement?: GrantAgreement | null
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
