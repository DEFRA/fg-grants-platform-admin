import type {
  EntitlementField,
  EntitlementTemplate,
  GrantEntitlements,
  HelpBlock,
  TemplatePosition
} from '../use-cases/get-grant-page.use-case.ts'
import { contextRootsOf } from './payment-definition.ts'

export interface Chip {
  parts: string[]
  /** A phase, or a phase and stage: every status under it. */
  prefix: boolean
  href: string
}

type Role = 'neutral' | 'info' | 'success' | 'warning'

interface OnSubmit {
  label:
    | 'Never claimable'
    | 'Waits for approval: no payment, no move'
    | 'Pays now'
    | 'No payment file'
  role: Role
  movesOnLastClaim: boolean
}

type Warning =
  | { kind: 'materialised-claim' | 'no-claimable-at'; claimCode: string }
  | {
      kind: 'claim-payment-reads-agreement'
      claimCode: string
      paymentHref: string
    }

interface TemplateCard {
  claimCode: string
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
  onSubmit: OnSubmit
  fields: {
    name: string
    input: boolean
    text: string
    unit: string
    bounds: string[]
  }[]
  help: { summary: string; content: HelpBlock[] } | null
}

export interface EntitlementsTab {
  claims: {
    move: { from: Chip; to: Chip } | null
    paymentHref: string | null
    roles: { allOf: string[]; anyOf: string[] } | null
  }
  warnings: Warning[]
  templates: TemplateCard[]
}

interface EntitlementsSource {
  entitlements: GrantEntitlements
  /** The version names a payment file, stored or not. */
  hasPaymentFile: boolean
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

const neverClaimable: OnSubmit = {
  label: 'Never claimable',
  role: 'neutral',
  movesOnLastClaim: false
}

const waitsForApproval: OnSubmit = {
  label: 'Waits for approval: no payment, no move',
  role: 'info',
  movesOnLastClaim: false
}

/** GAS raises the payment when the version names a payment file, stored or not. */
const toPaymentOutcome = (
  hasPaymentFile: boolean
): Omit<OnSubmit, 'movesOnLastClaim'> =>
  hasPaymentFile
    ? { label: 'Pays now', role: 'success' }
    : { label: 'No payment file', role: 'warning' }

const toOnSubmit = (
  template: EntitlementTemplate,
  hasPaymentFile: boolean,
  movesOnLastClaim: boolean
): OnSubmit => {
  if (!isClaimable(template)) {
    return neverClaimable
  }

  if (template.claim?.requiresApproval) {
    return waitsForApproval
  }

  return { ...toPaymentOutcome(hasPaymentFile), movesOnLastClaim }
}

const toChip =
  (hrefs: EntitlementsHrefs): ToChip =>
  ({ phase, stage, status }) => {
    const parts = [phase, stage, status].filter(
      (part): part is string => part !== undefined
    )
    const prefix = status === undefined

    return {
      parts,
      prefix,
      href: hrefs.phases(prefix ? null : parts.join(':'))
    }
  }

const toMove = (
  move: NonNullable<Claims>['onClaimApproval'],
  chip: ToChip
): EntitlementsTab['claims']['move'] =>
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

const toFieldText = ({ input, label, value }: EntitlementField): string =>
  input ? (label ?? '') : String(value)

const toUnit = ({ unitType, unit }: EntitlementField): string =>
  unit ? `${unitType} (${unit})` : unitType

const toFields = (
  fields: EntitlementTemplate['fields'] = {}
): TemplateCard['fields'] =>
  Object.entries(fields).map(([name, field]) => ({
    name,
    input: field.input,
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
  warn: (claimCode: string, paymentHref: string) => Warning
}

/** In this order within a template. */
const warningRules: WarningRule[] = [
  {
    applies: ({ materialised, claim }) => materialised && claim !== undefined,
    warn: (claimCode) => ({ kind: 'materialised-claim', claimCode })
  },
  {
    applies: (template) =>
      !template.materialised &&
      template.claim !== undefined &&
      claimableAtOf(template).length === 0,
    warn: (claimCode) => ({ kind: 'no-claimable-at', claimCode })
  },
  {
    applies: (template, readsAgreement) =>
      readsAgreement && paysOnSubmit(template),
    warn: (claimCode, paymentHref) => ({
      kind: 'claim-payment-reads-agreement',
      claimCode,
      paymentHref
    })
  }
]

/** Claim payments carry only `claim` and `execution` (`handle-claim-payment-requested.js`). */
const readsAgreement = (payment: object | null): boolean =>
  payment !== null && contextRootsOf(payment).has('agreement')

export const toEntitlementsTab = (
  { entitlements, hasPaymentFile }: EntitlementsSource,
  hrefs: EntitlementsHrefs
): EntitlementsTab => {
  const { entitlementTemplates, payment } = entitlements
  const claims = entitlements.claims ?? {}
  const chip = toChip(hrefs)
  const paymentReadsAgreement = readsAgreement(payment)

  return {
    claims: {
      move: toMove(claims.onClaimApproval, chip),
      paymentHref: hasPaymentFile ? hrefs.payment : null,
      roles: toRoles(claims.requiredRoles)
    },
    warnings: entitlementTemplates.flatMap((template) =>
      warningRules
        .filter(({ applies }) => applies(template, paymentReadsAgreement))
        .map(({ warn }) => warn(template.claimCode, hrefs.payment))
    ),
    templates: entitlementTemplates.map((template) => ({
      claimCode: template.claimCode,
      name: template.name,
      description: template.description ?? null,
      materialised: template.materialised,
      maxEntitlements: template.maxEntitlements,
      availableAt: template.availableAt.map(chip),
      claim: toClaimRules(template, chip),
      onSubmit: toOnSubmit(
        template,
        hasPaymentFile,
        claims.onClaimApproval !== undefined
      ),
      fields: toFields(template.fields),
      help: template.help ?? null
    }))
  }
}
