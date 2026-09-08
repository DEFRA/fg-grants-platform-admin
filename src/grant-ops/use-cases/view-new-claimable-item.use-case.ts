import type {
  Claims,
  EntitlementTemplate
} from '../repositories/claims.repository.ts'
import { findClaim } from '../repositories/claims.repository.ts'

export interface NewClaimableItemResponse extends Claims {
  claimableTemplate: EntitlementTemplate
}

export const viewNewClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  claimCode: string
): Promise<NewClaimableItemResponse> => {
  const { entitlementTemplate: claimableTemplate, ...claims } = await findClaim(
    code,
    clientRef,
    claimCode
  )

  return {
    ...claims,
    claimableTemplate
  }
}
