import type {
  Claims,
  EntitlementTemplate
} from '../repositories/claims.repository.ts'
import { findClaim } from '../repositories/claims.repository.ts'
import type { ConflictRefusal } from './gas-refusal.ts'
import { toConflictRefusal } from './gas-refusal.ts'

export interface NewClaimableItemResponse extends Omit<Claims, 'claims'> {
  claimableTemplate: EntitlementTemplate
}

export type NewClaimableItem =
  | { kind: 'page'; claimableItem: NewClaimableItemResponse }
  | ConflictRefusal

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
    toConflictRefusal
  )
