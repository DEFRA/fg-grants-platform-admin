import { getFromGas, postToGas } from '../../common/gas.ts'

export interface EntitlementTemplateField {
  input: boolean
  label?: string
  value?: string | number | boolean
  unitType: 'decimal' | 'integer' | 'string'
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
  availableAt: Array<{
    phase: string
    stage?: string
    status?: string
  }>
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

/**
 * A claim the applicant has submitted, as fg-gas-backend resolves it: against
 * the template it was made under, and the Payment it raised.
 *
 * There is no approval state: no claim carries one yet, so the Approval status
 * column stays blank until a grant requires approval and the workflow exists.
 */
export interface SubmittedClaim {
  clientClaimRef: string
  claimCode: string
  name: string
  // Absent for a grant that measures nothing.
  quantity: { value: number; unit: string } | null
  totalClaimAmountPence: number | null
  requiresApproval: boolean
  paymentScheduled: boolean
  submittedAt: string
}

export interface Claims {
  // Absent until a grant configures a claims page.
  banner?: Banner
  availableEntitlements: EntitlementTemplate[]
  claimableEntitlements: ClaimableEntitlement[]
  claims: SubmittedClaim[]
}

export interface ClaimableEntitlement {
  source: 'persisted'
  claimCode: string
  name: string
  description: string
  data: Record<string, EntitlementFieldValue>
  entitlementId: string
  instanceNumber: number
  claim: Record<string, unknown>
}

export interface Claim extends Claims {
  entitlementTemplate: EntitlementTemplate
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
    // The entitlement is the request body. `postToGas` takes its options
    // rather than a bare payload, because not every write to fg-gas-backend
    // has a body to send — a redrive is identified entirely by its path.
    { payload: entitlement }
  )

export const findClaims = async (
  code: string,
  clientRef: string
): Promise<Claims> =>
  getFromGas<Claims>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
  )

export const findClaim = async (
  code: string,
  clientRef: string,
  claimCode: string
): Promise<Claim> =>
  getFromGas<Claim>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims/${encodeURIComponent(claimCode)}`
  )
