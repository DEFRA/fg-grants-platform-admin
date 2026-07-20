import type { Request, ResponseToolkit } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { redirectCookieName } from './oidc.ts'

/**
 * The signed in user lives in the yar session, which is backed by Redis in
 * deployed environments. Only a session id travels in the cookie, so tokens
 * never reach the browser.
 */
const sessionKey = 'auth'

interface EntraClaims {
  oid?: string
  sub?: string
  email?: string
  preferred_username?: string
  name?: string
  roles?: string[]
}

export function setAuthSession(request: Request, session: OidcToken) {
  const { accessToken, refreshToken, idToken, claims } = session
  request.yar.set(sessionKey, { accessToken, refreshToken, idToken, claims })
}

export function getAuthSession(request: Request): OidcToken | undefined {
  return request.yar.get(sessionKey) ?? undefined
}

export function clearAuthSession(request: Request) {
  request.yar.clear(sessionKey)
}

/**
 * A target is only honoured when it is a path on this site. `//host` would be
 * read by a browser as protocol relative and leave the service, so reject it
 * alongside anything else that is not rooted at a single slash.
 */
function isSameSitePath(redirectTo: unknown): redirectTo is string {
  return (
    typeof redirectTo === 'string' &&
    redirectTo.startsWith('/') &&
    !redirectTo.startsWith('//')
  )
}

/**
 * Remembers where the user was heading so the callback can return them there.
 */
export function redirectToWithMemory(
  request: Request,
  h: ResponseToolkit,
  destination: string
) {
  const redirectTo = `${request.url.pathname}${request.url.search}`

  return h.redirect(destination).state(redirectCookieName, redirectTo)
}

export function takeRedirectTo(request: Request, h: ResponseToolkit) {
  const redirectTo = request.state[redirectCookieName]
  h.unstate(redirectCookieName)

  return isSameSitePath(redirectTo) ? redirectTo : '/'
}

/**
 * Entra ID reports the app roles assigned to the user on the `roles` claim.
 * Exposing them as the credentials scope lets hapi enforce role requirements
 * declared with `options.auth.scope` on a route.
 */
export function toCredentials(session: OidcToken) {
  const claims = (session.claims ?? {}) as EntraClaims

  return {
    profile: {
      id: claims.oid ?? claims.sub,
      email: claims.email ?? claims.preferred_username,
      displayName: claims.name
    },
    scope: Array.isArray(claims.roles) ? claims.roles : []
  }
}
