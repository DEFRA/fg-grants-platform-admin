import type { Claims } from '../repositories/claims.repository.ts'
import { findClaims } from '../repositories/claims.repository.ts'

export type {
  Claims,
  EntitlementTemplate
} from '../repositories/claims.repository.ts'

export const getClaimsUseCase = async (
  code: string,
  clientRef: string
): Promise<Claims> => findClaims(code, clientRef)
