import type { EntitlementTemplate } from '../repositories/claims.repository.ts'
import { updateEntitlement } from '../repositories/claims.repository.ts'
import { toEntitlementData } from './entitlement-data.ts'
import type { GasRefusal } from './gas-refusal.ts'
import { toGasRefusal } from './gas-refusal.ts'

export const updateClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  entitlementId: string,
  template: EntitlementTemplate,
  form: Record<string, string>,
  actor?: string
): Promise<GasRefusal | undefined> => {
  try {
    await updateEntitlement(
      {
        clientRef,
        grantCode: code,
        entitlementId,
        data: toEntitlementData(template, form)
      },
      actor
    )

    return undefined
  } catch (error) {
    const refusal = toGasRefusal(error)

    if (!refusal) {
      throw error
    }

    return refusal
  }
}
