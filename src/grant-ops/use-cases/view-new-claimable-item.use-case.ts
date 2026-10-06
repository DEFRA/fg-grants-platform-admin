import type {
  Claims,
  EntitlementTemplate
} from '../repositories/claims.repository.ts'
import { findClaim } from '../repositories/claims.repository.ts'
import { conflict, toGasRefusal } from './gas-refusal.ts'

export interface NewClaimableItemResponse extends Omit<Claims, 'claims'> {
  claimableTemplate: EntitlementTemplate
}

export type NewClaimableItem =
  | { kind: 'page'; claimableItem: NewClaimableItemResponse }
  | { kind: 'refusal'; message: string }

const asRefusal = (error: unknown): NewClaimableItem => {
  const refusal = toGasRefusal(error)

  if (refusal?.statusCode !== conflict) {
    throw error
  }

  return { kind: 'refusal', message: refusal.message }
}

export const viewNewClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  claimCode: string
): Promise<NewClaimableItem> =>
  findClaim(code, clientRef, claimCode).then(
    ({
      entitlementTemplate: claimableTemplate,
      ...claims
    }): NewClaimableItem => ({
      kind: 'page',
      claimableItem: { ...claims, claimableTemplate }
    }),
    asRefusal
  )
