import Boom from '@hapi/boom'
import { ResponseBodyError } from 'openid-client'

import { loginPath, redirectCookieName, redirectCookieOptions } from './oidc.js'
import {
  clearAuthSession,
  getAuthSession,
  redirectToWithMemory,
  setAuthSession,
  toCredentials
} from './session.js'

export const sessionStrategyName = 'session'

const schemeName = 'oidc-session'

function redirectToLogin(request, h) {
  return redirectToWithMemory(request, h, loginPath).takeover()
}

/**
 * True only when Entra ID itself rejected the refresh with a well-formed
 * OAuth error response (e.g. the refresh token was revoked or already used).
 * A network failure, timeout or unparsable response throws something else,
 * and means we don't know whether the session is actually dead.
 */
function isRefreshRejectedByEntra(error) {
  return error instanceof ResponseBodyError
}

/**
 * Turns the tokens saved at the end of the OIDC handshake into hapi credentials.
 *
 * Access tokens outlive a page view but not a session, so every authenticated
 * request refreshes one that is close to expiring, and re-saves it. Only a
 * refresh Entra ID actively rejects means the session is spent: clear it and
 * send the user back through login. Any other refresh failure (a network
 * blip, a timeout) leaves the session alone so the next request can retry.
 *
 * The scheme returns credentials and leaves role checks alone. Hapi compares
 * `credentials.scope` against any `auth.scope` a route declares, and answers a
 * signed in user who lacks the role with a 403.
 */
function oidcSessionScheme() {
  return {
    async authenticate(request, h) {
      const session = getAuthSession(request)

      if (!session) {
        return redirectToLogin(request, h)
      }

      try {
        const { token, refreshed } = await request.ensureValidToken(session)

        if (refreshed) {
          const refreshedSession = { ...session, ...token }
          setAuthSession(request, refreshedSession)

          return h.authenticated({
            credentials: toCredentials(refreshedSession)
          })
        }
      } catch (error) {
        if (!isRefreshRejectedByEntra(error)) {
          request.logger.warn(
            error,
            'Could not refresh the access token, leaving the session in place to retry'
          )
          throw Boom.serverUnavailable('Could not refresh the session')
        }

        request.logger.warn(
          error,
          'Refresh token rejected, sending the user back to login'
        )
        clearAuthSession(request)

        return redirectToLogin(request, h)
      }

      return h.authenticated({ credentials: toCredentials(session) })
    }
  }
}

/**
 * Registers the `session` strategy without making it the server default, so a
 * route is anonymous unless it opts in with `options.auth`.
 */
export const sessionStrategy = {
  plugin: {
    name: 'session-strategy',
    dependencies: ['hapi-auth-oidc', '@hapi/yar'],
    register(server) {
      server.state(redirectCookieName, redirectCookieOptions)
      server.auth.scheme(schemeName, oidcSessionScheme)
      server.auth.strategy(sessionStrategyName, schemeName)
    }
  }
}
