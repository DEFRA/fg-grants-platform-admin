import type { ClaimableItem } from '../repositories/claims.repository.ts'
import { findEntitlement } from '../repositories/claims.repository.ts'
import type { ConflictRefusal } from './gas-refusal.ts'
import { toConflictRefusal } from './gas-refusal.ts'

export type { ClaimableItem } from '../repositories/claims.repository.ts'

export type ChangeClaimableItem =
  | { kind: 'page'; claimableItem: ClaimableItem }
  | ConflictRefusal

export const viewChangeClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  entitlementId: string
): Promise<ChangeClaimableItem> =>
  findEntitlement(code, clientRef, entitlementId).then(
    (claimableItem): ChangeClaimableItem => ({ kind: 'page', claimableItem }),
    toConflictRefusal
  )
