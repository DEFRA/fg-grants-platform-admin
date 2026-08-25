import { config } from '../../common/config.ts'
import { wreck } from '../../common/wreck.ts'

export interface EntitlementField {
  label: string
  input: boolean
  unitType: string
  unit?: string | null
}

export interface EntitlementTemplate {
  claimCode: string
  name: string
  description?: string
  materialised: boolean
  maxEntitlements: number
  fields: Record<string, EntitlementField>
  availableAt: {
    phase: string
    stage?: string
    status?: string
  }
}

export interface Claims {
  availableEntitlements: EntitlementTemplate[]
  claimableEntitlements: unknown[]
  claims: unknown[]
}

export const findClaims = async (
  code: string,
  clientRef: string
): Promise<Claims> => {
  const url = `${config.get('gas.apiUrl')}/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`

  const { payload } = await wreck.get<Claims>(url, {
    json: true,
    headers: {
      authorization: `Bearer ${config.get('gas.serviceToken')}`
    }
  })

  return payload
}
