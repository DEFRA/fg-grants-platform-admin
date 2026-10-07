import type { EntitlementTemplate } from '../repositories/claims.repository.ts'
import { createEntitlement } from '../repositories/claims.repository.ts'
import { toEntitlementData } from './entitlement-data.ts'
import type { GasRefusal } from './gas-refusal.ts'
import { toGasRefusal } from './gas-refusal.ts'

export const createClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  template: EntitlementTemplate,
  form: Record<string, string>
): Promise<GasRefusal | undefined> => {
  try {
    await createEntitlement({
      clientRef,
      grantCode: code,
      claimCode: template.claimCode,
      data: toEntitlementData(template, form)
    })

    return undefined
  } catch (error) {
    const refusal = toGasRefusal(error)

    if (!refusal) {
      throw error
    }

    return refusal
  }
}
