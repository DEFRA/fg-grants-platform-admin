import type {
  Banner,
  BannerField,
  Claims,
  EntitlementTemplate,
  EntitlementTemplateField
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
      ? `${base}/claims/entitlements/${encodeURIComponent(template.claimCode)}#new-entitlement`
      : undefined,
    unavailableReason: canCreate ? undefined : 'Maximum created'
  }
}

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
  { banner, availableEntitlements }: Claims & { banner: Banner }
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
    )
  }
}
