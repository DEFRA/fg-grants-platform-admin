import { redirectCookieName } from './oidc.js'

/**
 * The signed in user lives in the yar session, which is backed by Redis in
 * deployed environments. Only a session id travels in the cookie, so tokens
 * never reach the browser.
 */
const sessionKey = 'auth'

export function setAuthSession(
  request,
  { accessToken, refreshToken, idToken, claims }
) {
  request.yar.set(sessionKey, { accessToken, refreshToken, idToken, claims })
}

export function getAuthSession(request) {
  return request.yar.get(sessionKey)
}

export function clearAuthSession(request) {
  request.yar.clear(sessionKey)
}

/**
 * A target is only honoured when it is a path on this site. `//host` would be
 * read by a browser as protocol relative and leave the service, so reject it
 * alongside anything else that is not rooted at a single slash.
 */
function isSameSitePath(redirectTo) {
  return (
    typeof redirectTo === 'string' &&
    redirectTo.startsWith('/') &&
    !redirectTo.startsWith('//')
  )
}

/**
 * Remembers where the user was heading so the callback can return them there.
 */
export function redirectToWithMemory(request, h, destination) {
  const redirectTo = `${request.url.pathname}${request.url.search}`

  return h.redirect(destination).state(redirectCookieName, redirectTo)
}

export function takeRedirectTo(request, h) {
  const redirectTo = request.state[redirectCookieName]
  h.unstate(redirectCookieName)

  return isSameSitePath(redirectTo) ? redirectTo : '/'
}

/**
 * Entra ID reports the app roles assigned to the user on the `roles` claim.
 * Exposing them as the credentials scope lets hapi enforce role requirements
 * declared with `options.auth.scope` on a route.
 */
export function toCredentials(session) {
  const claims = session.claims ?? {}

  return {
    profile: {
      id: claims.oid ?? claims.sub,
      email: claims.email ?? claims.preferred_username,
      displayName: claims.name
    },
    scope: Array.isArray(claims.roles) ? claims.roles : []
  }
}
