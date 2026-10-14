import { getGrantAllowList } from '../repositories/allow-list.repository.ts'

export type { AllowListView } from '../repositories/allow-list.repository.ts'

/**
 * The allow list for one grant. GAS enforces admin access on this call for
 * real, so this exists only as the named seam grant-ops's routes call
 * through - matching getClaimsUseCase, not a place to re-decide access.
 */
export const getAllowListUseCase = getGrantAllowList
