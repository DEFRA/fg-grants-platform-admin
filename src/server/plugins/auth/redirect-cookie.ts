import type { Request, ResponseToolkit } from '@hapi/hapi'

import { config } from '../../../common/config.ts'

const authConfig = config.get('auth')
const isSecure = config.get('session.cookie.secure')

const tenMinutesMs = 600_000

export const redirectCookieName = 'auth-redirect'

/**
 * Where the user was heading before login has to survive the trip through
 * Entra ID, which returns them cross-site. The yar session cookie is SameSite
 * Lax and so is withheld on the `form_post` callback, hence this separate
 * cookie, relaxed the same way as the plugin's own PKCE cookie. Iron encoding
 * keeps it tamper proof, so it cannot be rewritten into an open redirect.
 */
export const redirectCookieOptions = {
  password: authConfig.cookie.password,
  encoding: 'iron' as const,
  isSecure,
  isSameSite: (isSecure ? 'None' : 'Lax') as 'None' | 'Lax',
  isHttpOnly: true,
  path: '/',
  ttl: tenMinutesMs,
  clearInvalid: true,
  ignoreErrors: true
}

/**
 * `//host` reads to a browser as protocol relative and would leave the service,
 * and so does `/\host`, because the url parser treats a backslash at the start
 * of a path as a slash. A target counts as same site only when rooted at a
 * single slash followed by neither.
 */
const isSameSitePath = (redirectTo: unknown): redirectTo is string =>
  typeof redirectTo === 'string' && /^\/(?![/\\])/.test(redirectTo)

// Remembers where the user was heading so the callback can return them there.
export const redirectToWithMemory = (
  request: Request,
  h: ResponseToolkit,
  destination: string
) => {
  const redirectTo = `${request.url.pathname}${request.url.search}`

  return h.redirect(destination).state(redirectCookieName, redirectTo)
}

export const takeRedirectTo = (request: Request, h: ResponseToolkit) => {
  const redirectTo = request.state[redirectCookieName]
  h.unstate(redirectCookieName)

  return isSameSitePath(redirectTo) ? redirectTo : '/'
}
