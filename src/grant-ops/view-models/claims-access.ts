export type ClaimsAccessTier = 'full' | 'view-only' | 'hidden'

export interface RequiredRoles {
  allOf: string[]
  anyOf: string[]
}

const allHeld = (held: Set<string>, allOf: string[]): boolean =>
  allOf.every((role) => held.has(role))

const anyHeld = (held: Set<string>, anyOf: string[]): boolean =>
  anyOf.length === 0 || anyOf.some((role) => held.has(role))

const satisfies = (heldRoles: string[], roles: RequiredRoles): boolean => {
  if (heldRoles.length === 0) return false

  const held = new Set(heldRoles)

  return allHeld(held, roles.allOf) && anyHeld(held, roles.anyOf)
}

const hasNoRoles = (cwRoles: string[] | null | undefined): boolean =>
  !Array.isArray(cwRoles) || cwRoles.length === 0

/**
 * - `full` when the user satisfies `claims.requiredRoles`, or when the grant
 *   has not configured any.
 * - `view-only` when the user exists in CW (has any roles) but does not
 *   satisfy `claims.requiredRoles`.
 * - `hidden` when the user has no CW roles (unknown user or CW unreachable).
 */
export const resolveClaimsAccess = (
  cwRoles: string[] | null | undefined,
  claimsRequiredRoles: RequiredRoles | null | undefined
): ClaimsAccessTier => {
  if (!claimsRequiredRoles) return 'full'
  if (hasNoRoles(cwRoles)) return 'hidden'
  if (satisfies(cwRoles!, claimsRequiredRoles)) return 'full'

  return 'view-only'
}
