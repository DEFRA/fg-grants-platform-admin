import type { Claims } from '../repositories/claims.repository.ts'
import { findClaims } from '../repositories/claims.repository.ts'

export type {
  Banner,
  BannerField,
  Claims,
  EntitlementTemplate,
  EntitlementTemplateField
} from '../repositories/claims.repository.ts'

/**
 * Everything the claims page shows about one application, in one call.
 *
 * The /grant-admin surface of fg-gas-backend is a backend for frontend by
 * design - kept separate so it can be split away from GAS with the components
 * it serves. it answers with the page, header included, rather than leaving
 * this app to gather the parts.
 */
export const getClaimsUseCase = async (
  code: string,
  clientRef: string
): Promise<Claims> => findClaims(code, clientRef)
