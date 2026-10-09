import type { Request } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { User } from './user.ts'

// `oid` is the user's immutable object id in the tenant, and the only
// identifier worth keying on.
type EntraClaims = {
  oid: string
  email?: string
  name?: string
  roles?: string[]
}

/**
 * Derived rather than redeclared, because hapi merges the
 * `AuthCredentialsExtra` declared in ../../../types/hapi-augmentation.d.ts into
 * `request.auth.credentials` alone. Naming hapi's own `AuthCredentials` type
 * gets the unmerged base, where `user` is an optional `UserCredentials` with
 * none of our fields on it.
 */
export type Credentials = Request['auth']['credentials']

const sessionKey = 'auth'
const cwRolesKey = 'cwRoles'

export const setAuthSession = (request: Request, session: OidcToken) => {
  const { accessToken, refreshToken, idToken, claims } = session
  request.yar.set(sessionKey, { accessToken, refreshToken, idToken, claims })
}

export const getAuthSession = (request: Request): OidcToken | undefined =>
  request.yar.get(sessionKey) ?? undefined

export const setCwRolesSession = (request: Request, roles: string[] | null) => {
  request.yar.set(cwRolesKey, roles)
}

export const getCwRolesSession = (request: Request): string[] | null => {
  const stored = request.yar.get(cwRolesKey)
  return stored === undefined ? null : (stored as string[] | null)
}

export const clearAuthSession = (request: Request) => {
  request.yar.clear(sessionKey)
  request.yar.clear(cwRolesKey)
}

// The claims come back from Redis as untyped JSON, so this asserts rather than
// proves the shape. Entra ID issues `oid` on every token it signs.
const claimsOf = (session: OidcToken) =>
  (session.claims ?? {}) as unknown as EntraClaims

// Exposing the Entra ID `roles` claim as the credentials scope lets hapi
// enforce the role requirements a route declares with `options.auth.scope`.
// CW roles are not merged into scope: they are per-grant and checked dynamically.
const toRoles = (roles: unknown): string[] =>
  Array.isArray(roles) ? roles : []

export const toCredentials = (
  session: OidcToken,
  cwRoles: string[] | null = null
): Credentials => {
  const claims = claimsOf(session)

  const user = new User({
    id: claims.oid,
    email: claims.email ?? '',
    name: claims.name ?? '',
    roles: toRoles(claims.roles),
    cwRoles
  })

  return { user, scope: user.roles }
}
