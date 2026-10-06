import type {
  Banner,
  BannerField,
  ClaimableEntitlement,
  Claims,
  EntitlementTemplate,
  EntitlementTemplateField,
  SubmittedClaim
} from '../use-cases/get-claims.use-case.ts'

// Unit codes a grant definition may carry on a decimal field. Anything not
// named here is shown as the definition spells it, which is more use to a case
// officer than an empty column.
const unitLabels: Record<string, string> = {
  HA: 'Hectares'
}

export interface HeaderField {
  label?: string
  text: string
}

export interface Header {
  title: string
  summary: HeaderField[]
}

export interface EntitlementRow {
  claimCode: string
  name: string
  type?: string
  createdCount: number
  maxEntitlements: number
  canCreate: boolean
  createHref?: string
  unavailableReason?: string
}

export interface AwaitingClaimRow {
  entitlementId: string
  claimCode: string
  description: string
  amount: string
  changeHref?: string
}

export interface ClaimedRow {
  name: string
  clientClaimRef: string
  quantity: string
  value: string
  requiresApproval: string
  approvalStatus: string
  paymentStatus: string
}

export interface Tab {
  text: string
  href: string
  current: boolean
}

export interface ClaimsPage {
  code: string
  clientRef: string
  claimsHref: string
  header: Header
  tabs: Tab[]
  entitlements: EntitlementRow[]
  awaitingClaims: AwaitingClaimRow[]
  claimed: ClaimedRow[]
}

// The unit a case officer is asked to enter says what kind of entitlement this
// is, so a collected field is preferred over one the definition fixes.
const primaryField = (
  fields: Record<string, EntitlementTemplateField> = {}
): EntitlementTemplateField | undefined => {
  const withUnit = Object.values(fields).filter((field) => field.unit)

  return withUnit.find((field) => field.input) ?? withUnit[0]
}

export const toTypeLabel = (
  template: EntitlementTemplate
): string | undefined => {
  const unit = primaryField(template.fields)?.unit

  return unit ? (unitLabels[unit] ?? unit) : undefined
}

const toEntitlementRow = (
  base: string,
  template: EntitlementTemplate
): EntitlementRow => {
  // fg-gas-backend answers with the templates that are still under their
  // maximum and does not yet report how many exist, so the count reads zero
  // until it does.
  const createdCount = template.createdCount ?? 0
  const canCreate = createdCount < template.maxEntitlements

  return {
    claimCode: template.claimCode,
    name: template.name,
    type: toTypeLabel(template),
    createdCount,
    maxEntitlements: template.maxEntitlements,
    canCreate,
    createHref: canCreate
      ? `${base}/claims/new-entitlement/${encodeURIComponent(template.claimCode)}#new-entitlement`
      : undefined,
    unavailableReason: canCreate ? undefined : 'Maximum created'
  }
}

const formatAmount = (value: string | number | boolean): string =>
  typeof value === 'number'
    ? new Intl.NumberFormat('en-GB').format(value)
    : String(value)

const templateFor = (
  claimCode: string,
  templates: EntitlementTemplate[]
): EntitlementTemplate | undefined =>
  templates.find((template) => template.claimCode === claimCode)

const unitFor = (
  template: EntitlementTemplate | undefined,
  fieldName: string
): string | undefined => template?.fields?.[fieldName]?.unit

const amountFieldFor = (
  data: ClaimableEntitlement['data'],
  template: EntitlementTemplate | undefined
) => Object.entries(data).find(([fieldName]) => unitFor(template, fieldName))

const formattedAmount = (
  amountField: [string, ClaimableEntitlement['data'][string]] | undefined,
  template: EntitlementTemplate | undefined
): string => {
  if (!amountField) {
    return ''
  }

  const [fieldName, fieldValue] = amountField
  const unit = unitFor(template, fieldName)

  return unit ? `${formatAmount(fieldValue.value)} ${unit.toLowerCase()}` : ''
}

const toAwaitingClaimRow = (
  base: string,
  claimableEntitlement: ClaimableEntitlement,
  templates: EntitlementTemplate[]
): AwaitingClaimRow => {
  const template = templateFor(claimableEntitlement.claimCode, templates)

  return {
    entitlementId: claimableEntitlement.entitlementId,
    claimCode: claimableEntitlement.claimCode,
    description: claimableEntitlement.description,
    amount: formattedAmount(
      amountFieldFor(claimableEntitlement.data, template),
      template
    ),
    changeHref: claimableEntitlement.canEdit
      ? `${base}/claims/entitlements/${encodeURIComponent(claimableEntitlement.entitlementId)}/change#change-entitlement`
      : undefined
  }
}

const pencePerPound = 100

const formatValue = (totalClaimAmountPence: number | null): string => {
  if (totalClaimAmountPence === null) {
    return ''
  }

  const fractionDigits = totalClaimAmountPence % pencePerPound === 0 ? 0 : 2

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(totalClaimAmountPence / pencePerPound)
}

const formatQuantity = (quantity: SubmittedClaim['quantity']): string => {
  if (!quantity) {
    return ''
  }

  const amount = formatAmount(quantity.value)

  return quantity.unit ? `${amount} ${quantity.unit.toLowerCase()}` : amount
}

const toClaimedRow = (claim: SubmittedClaim): ClaimedRow => ({
  name: claim.name,
  clientClaimRef: claim.clientClaimRef,
  quantity: formatQuantity(claim.quantity),
  value: formatValue(claim.totalClaimAmountPence),
  requiresApproval: claim.requiresApproval ? 'Yes' : 'No',
  approvalStatus: '',
  paymentStatus: claim.paymentScheduled ? 'Payment scheduled' : ''
})

const toBase = (code: string, clientRef: string): string =>
  `/grant-ops/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}`

const toTabs = (claimsHref: string): Tab[] => {
  // The application data and payments pages arrive with later tickets, so
  // those tabs have nowhere to go yet.
  return [
    { text: 'Application data', href: '#', current: false },
    { text: 'Claims', href: claimsHref, current: true },
    { text: 'Payments', href: '#', current: false }
  ]
}

/**
 * The header, as configured. Which fields appear, their labels and their order
 * are the grant definition's to decide, so nothing here names one - a grant
 * that adds a field to its banner shows it without a change to this app.
 */
const toHeaderField = (field: BannerField): HeaderField => ({
  label: field.label,
  text: String(field.text)
})

const toTitle = (title: BannerField | undefined) =>
  title ? String(title.text) : ''

const toHeader = (banner: Banner): Header => ({
  title: toTitle(banner.title),
  summary: Object.values(banner.summary ?? {}).map(toHeaderField)
})

export const toClaimsPage = (
  code: string,
  clientRef: string,
  {
    banner,
    availableEntitlements,
    claimableEntitlements,
    claims = []
  }: Omit<Claims, 'claims'> & { banner: Banner; claims?: SubmittedClaim[] }
): ClaimsPage => {
  const base = toBase(code, clientRef)
  const claimsHref = `${base}/claims`

  return {
    code,
    clientRef,
    claimsHref,
    header: toHeader(banner),
    tabs: toTabs(claimsHref),
    entitlements: availableEntitlements.map((template) =>
      toEntitlementRow(base, template)
    ),
    awaitingClaims: claimableEntitlements.map((claimableEntitlement) =>
      toAwaitingClaimRow(base, claimableEntitlement, availableEntitlements)
    ),
    claimed: claims.map(toClaimedRow)
  }
}

export const toClaimsRefusalPage = (
  code: string,
  clientRef: string,
  claims: Parameters<typeof toClaimsPage>[2],
  errorSummary: { text: string }[]
) => ({
  pageTitle: 'Error: Claims',
  errorSummary,
  ...toClaimsPage(code, clientRef, claims)
})

export const toClaimsPageTitle = (errorSummary: { text: string }[] = []) =>
  errorSummary.length
    ? { pageTitle: 'Error: Claims', errorSummary }
    : { pageTitle: 'Claims' }
