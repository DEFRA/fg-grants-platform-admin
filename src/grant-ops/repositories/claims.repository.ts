import { getFromGas, postToGas } from '../../common/gas.ts'

export interface EntitlementTemplateField {
  input: boolean
  label?: string
  value?: string | number | boolean
  unitType: 'decimal' | 'string'
  decimalPlaces?: number
  unit?: string
  minValue?: number | null
  maxValue?: number | null
  minLength?: number | null
  maxLength?: number | null
}

export interface HelpBlock {
  text?: string
  items?: string[]
}

export interface Help {
  summary: string
  content: HelpBlock[]
}

export interface EntitlementTemplate {
  claimCode: string
  name: string
  description?: string
  help?: Help
  materialised: boolean
  fields?: Record<string, EntitlementTemplateField>
  maxEntitlements: number
  createdCount?: number
  availableAt: {
    phase: string
    stage?: string
    status?: string
  }
}

export interface BannerField {
  label?: string
  text: string | number | boolean
  type: string
  format?: string
}

export interface Banner {
  title?: BannerField
  summary?: Record<string, BannerField>
}

export interface Claims {
  // Absent until a grant configures a claims page.
  banner?: Banner
  availableEntitlements: EntitlementTemplate[]
  claimableEntitlements: unknown[]
  claims: unknown[]
}

export interface EntitlementFieldValue {
  value: string | number | boolean
}

export interface NewEntitlement {
  clientRef: string
  grantCode: string
  claimCode: string
  data: Record<string, EntitlementFieldValue>
}

export const createEntitlement = async (
  entitlement: NewEntitlement
): Promise<void> =>
  postToGas(
    `/grant-admin/grants/${encodeURIComponent(entitlement.grantCode)}/applications/${encodeURIComponent(entitlement.clientRef)}/claims/entitlements`,
    entitlement
  )

export const findClaims = async (
  code: string,
  clientRef: string
): Promise<Claims> =>
  getFromGas<Claims>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
  )
