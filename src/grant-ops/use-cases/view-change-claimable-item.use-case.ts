import type { ClaimableItem } from '../repositories/claims.repository.ts'
import { findEntitlement } from '../repositories/claims.repository.ts'
import { conflict, toGasRefusal } from './gas-refusal.ts'

export type { ClaimableItem } from '../repositories/claims.repository.ts'

export type ChangeClaimableItem =
  | { kind: 'page'; claimableItem: ClaimableItem }
  | { kind: 'refusal'; message: string }

const asRefusal = (error: unknown): ChangeClaimableItem => {
  const refusal = toGasRefusal(error)

  if (refusal?.statusCode !== conflict) {
    throw error
  }

  return { kind: 'refusal', message: refusal.message }
}

export const viewChangeClaimableItemUseCase = async (
  code: string,
  clientRef: string,
  entitlementId: string
): Promise<ChangeClaimableItem> =>
  findEntitlement(code, clientRef, entitlementId).then(
    (claimableItem): ChangeClaimableItem => ({ kind: 'page', claimableItem }),
    asRefusal
  )
