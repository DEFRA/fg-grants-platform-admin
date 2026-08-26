import Boom from '@hapi/boom'

import { getClaimsUseCase } from './get-claims.use-case.ts'
import type {
  Claims,
  EntitlementTemplate
} from '../repositories/claims.repository.ts'

export const findItemByCode = (
  claimCode: string,
  availableEntitlements: EntitlementTemplate[]
) => {
  return availableEntitlements.find(
    (ae) =>
      ae.claimCode === claimCode &&
      ae.materialised === false &&
      (ae.createdCount ?? 0) < ae.maxEntitlements
  )
}

export interface NewClaimableItemResponse extends Claims {
  claimableTemplate: EntitlementTemplate
}

export const viewNewClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  claimCode: string
): Promise<NewClaimableItemResponse> => {
  const { banner, availableEntitlements, claimableEntitlements, claims } =
    await getClaimsUseCase(code, clientRef)

  const claimable = findItemByCode(claimCode, availableEntitlements)

  if (!claimable) {
    throw Boom.notFound(`Claimable item ${claimCode} not found`)
  }

  return {
    banner,
    availableEntitlements,
    claimableTemplate: claimable,
    claimableEntitlements,
    claims
  }
}
