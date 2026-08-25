import { getFromGas } from '../../common/gas.ts'

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

export interface EntitlementTemplate {
  claimCode: string
  name: string
  description?: string
  materialised: boolean
  fields?: Record<string, EntitlementTemplateField>
  maxEntitlements: number
  // fg-gas-backend leaves out every template already at its maximum, so this
  // only arrives once that endpoint starts reporting what has been created.
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

export const findClaims = async (
  code: string,
  clientRef: string
): Promise<Claims> =>
  getFromGas<Claims>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
  )
