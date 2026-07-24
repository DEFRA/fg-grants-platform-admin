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

export const setAuthSession = (request: Request, session: OidcToken) => {
  const { accessToken, refreshToken, idToken, claims } = session
  request.yar.set(sessionKey, { accessToken, refreshToken, idToken, claims })
}

export const getAuthSession = (request: Request): OidcToken | undefined =>
  request.yar.get(sessionKey) ?? undefined

export const clearAuthSession = (request: Request) => {
  request.yar.clear(sessionKey)
}

// The claims come back from Redis as untyped JSON, so this asserts rather than
// proves the shape. Entra ID issues `oid` on every token it signs.
const claimsOf = (session: OidcToken) =>
  (session.claims ?? {}) as unknown as EntraClaims

// Exposing the Entra ID `roles` claim as the credentials scope lets hapi
// enforce the role requirements a route declares with `options.auth.scope`.
export const toCredentials = (session: OidcToken): Credentials => {
  const { oid, email = '', name = '', roles } = claimsOf(session)

  const user = new User({
    id: oid,
    email,
    name,
    roles: Array.isArray(roles) ? roles : []
  })

  return {
    user,
    scope: user.roles
  }
}
