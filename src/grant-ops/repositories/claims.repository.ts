import { getFromGas, postToGas, putToGas } from '../../common/gas.ts'

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

export interface SubmittedClaim {
  clientClaimRef: string
  claimCode: string
  name: string
  quantity: { value: number; unit: string | null } | null
  totalClaimAmountPence: number | null
  requiresApproval: boolean
  paymentScheduled: boolean
  submittedAt: string
}

export type ClaimsAccess = 'full' | 'view-only'

export interface Claims {
  // Absent until a grant configures a claims page.
  banner?: Banner
  availableEntitlements: EntitlementTemplate[]
  claimableEntitlements: ClaimableEntitlement[]
  claims: SubmittedClaim[]
  access: ClaimsAccess
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
  canEdit: boolean
}

export interface Claim extends Omit<Claims, 'claims'> {
  entitlementTemplate: EntitlementTemplate
}

export interface ClaimableItem extends Claims {
  claimableEntitlement: ClaimableEntitlement
  entitlementTemplate: EntitlementTemplate
}

/** What GAS answers with, where `access` may be absent. */
type GasAnswer<T extends { access: ClaimsAccess }> = Omit<T, 'access'> & {
  access?: ClaimsAccess
}

/** Only full access offers changes; anything else, an absent answer included, is view-only. */
const withAccess = <T extends { access: ClaimsAccess }>({
  access,
  ...answer
}: GasAnswer<T>) => ({
  ...answer,
  access: access === 'full' ? ('full' as const) : ('view-only' as const)
})

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

export interface EntitlementUpdate {
  clientRef: string
  grantCode: string
  entitlementId: string
  data: Record<string, EntitlementFieldValue>
}

export const updateEntitlement = async ({
  clientRef,
  grantCode,
  entitlementId,
  data
}: EntitlementUpdate): Promise<void> =>
  putToGas(
    `/grant-admin/grants/${encodeURIComponent(grantCode)}/applications/${encodeURIComponent(clientRef)}/claims/entitlements/${encodeURIComponent(entitlementId)}`,
    { payload: { data } }
  )

export const findClaims = async (
  code: string,
  clientRef: string
): Promise<Claims> =>
  withAccess(
    await getFromGas<GasAnswer<Claims>>(
      `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
    )
  )

export const findClaim = async (
  code: string,
  clientRef: string,
  claimCode: string
): Promise<Claim> =>
  withAccess(
    await getFromGas<GasAnswer<Claim>>(
      `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims/${encodeURIComponent(claimCode)}`
    )
  )

export const findEntitlement = async (
  code: string,
  clientRef: string,
  entitlementId: string
): Promise<ClaimableItem> =>
  withAccess(
    await getFromGas<GasAnswer<ClaimableItem>>(
      `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims/entitlements/${encodeURIComponent(entitlementId)}`
    )
  )
