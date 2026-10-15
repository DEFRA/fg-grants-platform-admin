import { getClaimsUseCase } from './get-claims.use-case.ts'

export interface ClaimsAccessRefusal {
  message: string
}

/**
 * GAS decides claims access; only full access may create or change an item.
 * @param operation What the operator was refused, as the refusal names it.
 */
export const requireFullClaimsAccessUseCase = async (
  code: string,
  clientRef: string,
  operation: 'create' | 'change'
): Promise<ClaimsAccessRefusal | undefined> => {
  const { access } = await getClaimsUseCase(code, clientRef)

  return access === 'full'
    ? undefined
    : {
        message: `You do not have the required roles to ${operation} claimable items`
      }
}
