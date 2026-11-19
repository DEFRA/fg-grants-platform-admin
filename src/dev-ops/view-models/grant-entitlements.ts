import { toHumanCode } from './position.ts'
import type {
  EntitlementField,
  EntitlementTemplate,
  GrantEntitlements,
  HelpBlock,
  TemplatePosition
} from '../use-cases/get-grant-page.use-case.ts'
import { contextRootsOf, toMappingValue } from './mapping-table.ts'
import type { Words } from './words.ts'

/** A position, linked to it on Phases; one that stops at the phase or stage is every status under it. */
export interface Chip {
  /** The status's name in the grant, or the phase and stage of a prefix. */
  label: string
  /** The full position. */
  code: string
  any: 'status' | 'stage-and-status' | null
  href: string
}

interface Move {
  from: Chip
  to: Chip
}

type OnSubmit =
  | 'cant-claim'
  | 'waits-for-approval'
  | 'requests-payment'
  | 'no-payment-file'

type Warning =
  | { kind: 'materialised-claim' | 'no-claimable-at' }
  | { kind: 'claim-payment-reads-agreement'; paymentHref: string }

/** The template's badge for what a submitted claim does. */
export interface SubmitBadge {
  text: string
  tone: 'neutral' | 'warning' | 'danger'
}

/** A problem with one template, as its alert says it. */
export interface TemplateAlert {
  tone: 'warning' | 'danger'
  title: string
  text: Words
}

/** GAS fetches a payment file it has not stored when it first needs it, and refuses one it has marked failed. */
export type PaymentFileState = 'stored' | 'not-stored' | 'failed'

type FieldSource = 'Entered' | 'Fixed' | 'From agreement'

interface TemplateCard {
  name: string
  description: string | null
  materialised: boolean
  maxEntitlements: number
  availableAt: Chip[]
  claim: {
    claimableAt: Chip[]
    maximumClaims: number
    partial: boolean
    approval: boolean
    evidence: boolean
  } | null
  badge: SubmitBadge
  /** Marks a template no claim can be made against. */
  cantClaim: boolean
  alerts: TemplateAlert[]
  fields: {
    name: string
    source: FieldSource
    text: string
    unit: string
    bounds: string[]
  }[]
  help: { summary: string; content: HelpBlock[] } | null
}

export interface EntitlementsTab {
  /** No template and no claim rules: nothing to show but that. */
  nothing: boolean
  claims: {
    move: Move | null
    paymentHref: string | null
    roles: { allOf: string[]; anyOf: string[] } | null
  }
  templates: TemplateCard[]
}

interface EntitlementsSource {
  entitlements: GrantEntitlements
  /** Null when the version names no payment file. */
  payment: PaymentFileState | null
}

interface EntitlementsHrefs {
  /** The Phases tab, with that status selected. */
  phases: (status: string | null) => string
  payment: string
}

type Claims = GrantEntitlements['claims']

type ToChip = (position: TemplatePosition) => Chip

const claimableAtOf = ({ claim }: EntitlementTemplate): TemplatePosition[] =>
  claim?.claimableAt ?? []

/** GAS rejects every claim against a materialised template, one with no `claim`, or one with no `claimableAt`. */
const isClaimable = (template: EntitlementTemplate) =>
  !template.materialised && claimableAtOf(template).length > 0

/** GAS raises the payment on submit for a claim that needs no approval (`claims.service.js`). */
const paysOnSubmit = (template: EntitlementTemplate) =>
  isClaimable(template) && !template.claim?.requiresApproval

const submitBadges: Record<OnSubmit, SubmitBadge> = {
  'cant-claim': { text: 'Can’t be claimed', tone: 'danger' },
  'waits-for-approval': {
    text: 'On submit: Waits for approval',
    tone: 'neutral'
  },
  'requests-payment': { text: 'On submit: Requests payment', tone: 'neutral' },
  'no-payment-file': { text: 'On submit: No payment file', tone: 'warning' }
}

type AlertOf<K extends Warning['kind']> = (
  warning: Extract<Warning, { kind: K }>,
  name: string
) => TemplateAlert

const warningAlerts: { [K in Warning['kind']]: AlertOf<K> } = {
  'no-claimable-at': (_warning, name) => ({
    tone: 'danger',
    title: `${name} can’t be claimed.`,
    text: [
      'Its claim rules list no “Claimable at” status, so GAS rejects every claim (',
      { code: 'WRONG_POSITION' },
      '). Publish a version that sets ',
      { code: 'claim.claimableAt' },
      '.'
    ]
  }),
  'materialised-claim': (_warning, name) => ({
    tone: 'warning',
    title: `${name} can’t be claimed.`,
    text: [
      'It is materialised, which GAS doesn’t derive yet, so its claim rules never apply.'
    ]
  }),
  'claim-payment-reads-agreement': ({ paymentHref }, name) => ({
    tone: 'warning',
    title: `Claim payments for ${name} fail.`,
    text: [
      'Claim payments can only read ',
      { code: '$.claim' },
      ' and ',
      { code: '$.execution' },
      ', but the ',
      { link: 'payment definition', href: paymentHref },
      ' reads ',
      { code: '$.agreement' },
      ', so those fields resolve empty and GAS refuses the payment.'
    ]
  })
}

const toAlert = (warning: Warning, name: string): TemplateAlert =>
  (
    warningAlerts[warning.kind] as (
      warning: Warning,
      name: string
    ) => TemplateAlert
  )(warning, name)

/** GAS raises the payment when the version names a payment file, stored or not. */
const toPaymentOutcome = ({ payment }: EntitlementsSource): OnSubmit =>
  payment ? 'requests-payment' : 'no-payment-file'

const toOnSubmit = (
  template: EntitlementTemplate,
  source: EntitlementsSource
): OnSubmit => {
  if (!isClaimable(template)) {
    return 'cant-claim'
  }

  if (template.claim?.requiresApproval) {
    return 'waits-for-approval'
  }

  return toPaymentOutcome(source)
}

/** A stage prefix selects the stage's first status; a phase-only one has no stage to select, so it opens the phase's card. */
const toPrefixChip = (
  { phase, stage }: TemplatePosition,
  hrefs: EntitlementsHrefs
): Chip => {
  const code = stage ? `${phase}:${stage}` : phase

  return {
    label: code,
    code,
    any: stage ? 'status' : 'stage-and-status',
    href: stage ? hrefs.phases(code) : `${hrefs.phases(null)}#phase-${phase}`
  }
}

/** A status by its name in the grant, else its code made readable: never the bare code. */
const toStatusName = (
  names: Record<string, string> | undefined,
  code: string,
  status: string
): string => names?.[code] ?? toHumanCode(status)

const toChip =
  (hrefs: EntitlementsHrefs, names?: Record<string, string>): ToChip =>
  (position) => {
    if (!position.status || !position.stage) {
      return toPrefixChip(position, hrefs)
    }

    const code = [position.phase, position.stage, position.status].join(':')

    return {
      label: toStatusName(names, code, position.status),
      code,
      any: null,
      href: hrefs.phases(code)
    }
  }

const toMove = (
  move: NonNullable<Claims>['onClaimApproval'],
  chip: ToChip
): Move | null =>
  move
    ? { from: chip(move.currentPosition), to: chip(move.targetPosition) }
    : null

const toRoles = (
  roles: NonNullable<Claims>['requiredRoles']
): EntitlementsTab['claims']['roles'] =>
  roles ? { allOf: roles.allOf ?? [], anyOf: roles.anyOf ?? [] } : null

const isPresent = (bound: string | null): bound is string => bound !== null

const toBound = (label: string, value: number | null | undefined) =>
  value === null || value === undefined ? null : `${label} ${value}`

const toBounds = (field: EntitlementField): string[] =>
  (field.unitType === 'decimal'
    ? [
        toBound('min', field.minValue),
        toBound('max', field.maxValue),
        `${field.decimalPlaces} dp`
      ]
    : [
        toBound('min length', field.minLength),
        toBound('max length', field.maxLength)
      ]
  ).filter(isPresent)

const isFromAgreement = ({ value }: EntitlementField): boolean =>
  toMappingValue(value).kind === 'expression'

/** GAS resolves a `jsonata:` value against the agreement when it creates the entitlement. */
const toSource = (field: EntitlementField): FieldSource => {
  if (field.input) {
    return 'Entered'
  }

  return isFromAgreement(field) ? 'From agreement' : 'Fixed'
}

const toFieldText = (field: EntitlementField): string => {
  if (field.input) {
    return field.label ?? ''
  }

  return toMappingValue(field.value).text
}

const toUnit = ({ unitType, unit }: EntitlementField): string =>
  unit ? `${unitType} (${unit})` : unitType

const toFields = (
  fields: EntitlementTemplate['fields'] = {}
): TemplateCard['fields'] =>
  Object.entries(fields).map(([name, field]) => ({
    name,
    source: toSource(field),
    text: toFieldText(field),
    unit: toUnit(field),
    bounds: toBounds(field)
  }))

const toClaimRules = (
  template: EntitlementTemplate,
  chip: ToChip
): TemplateCard['claim'] =>
  template.claim
    ? {
        claimableAt: claimableAtOf(template).map(chip),
        maximumClaims: template.claim.limits.maximumClaims,
        partial: template.claim.limits.allowsPartialClaims,
        approval: template.claim.requiresApproval,
        evidence: template.claim.requiresEvidence
      }
    : null

interface WarningRule {
  applies: (template: EntitlementTemplate, readsAgreement: boolean) => boolean
  warn: (paymentHref: string) => Warning
}

/** In this order within a template. */
const warningRules: WarningRule[] = [
  {
    applies: ({ materialised, claim }) => materialised && claim !== undefined,
    warn: () => ({ kind: 'materialised-claim' })
  },
  {
    applies: (template) =>
      !template.materialised &&
      template.claim !== undefined &&
      claimableAtOf(template).length === 0,
    warn: () => ({ kind: 'no-claimable-at' })
  },
  {
    applies: (template, readsAgreement) =>
      readsAgreement && paysOnSubmit(template),
    warn: (paymentHref) => ({
      kind: 'claim-payment-reads-agreement',
      paymentHref
    })
  }
]

/** Claim payments carry only `claim` and `execution` (`handle-claim-payment-requested.js`). */
const readsAgreement = (payment: Record<string, unknown> | null): boolean =>
  payment !== null && contextRootsOf(payment).has('agreement')

const hasClaimRules = (claims: NonNullable<Claims>): boolean =>
  claims.onClaimApproval !== undefined || claims.requiredRoles !== undefined

export const toEntitlementsTab = (
  source: EntitlementsSource,
  hrefs: EntitlementsHrefs
): EntitlementsTab => {
  const { entitlementTemplates, payment } = source.entitlements
  const claims = source.entitlements.claims ?? {}
  const chip = toChip(hrefs, source.entitlements.statusNames)
  const move = toMove(claims.onClaimApproval, chip)
  const paymentReadsAgreement = readsAgreement(payment)

  const toCard = (template: EntitlementTemplate): TemplateCard => {
    const onSubmit = toOnSubmit(template, source)

    return {
      name: template.name,
      description: template.description ?? null,
      materialised: template.materialised,
      maxEntitlements: template.maxEntitlements,
      availableAt: template.availableAt.map(chip),
      claim: toClaimRules(template, chip),
      badge: submitBadges[onSubmit],
      cantClaim: onSubmit === 'cant-claim',
      alerts: warningRules
        .filter(({ applies }) => applies(template, paymentReadsAgreement))
        .map(({ warn }) => toAlert(warn(hrefs.payment), template.name)),
      fields: toFields(template.fields),
      help: template.help ?? null
    }
  }

  return {
    nothing: entitlementTemplates.length === 0 && !hasClaimRules(claims),
    claims: {
      move,
      paymentHref: source.payment ? hrefs.payment : null,
      roles: toRoles(claims.requiredRoles)
    },
    templates: entitlementTemplates.map(toCard)
  }
}
