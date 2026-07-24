import Boom from '@hapi/boom'
import { ResponseBodyError } from 'openid-client'
import type { Request, ResponseToolkit } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { logger } from '../../../common/logger.ts'
import { redirectToWithMemory } from './redirect-cookie.ts'
import {
  clearAuthSession,
  getAuthSession,
  setAuthSession,
  toCredentials
} from './session.ts'
import { loginPath } from './paths.ts'

const redirectToLogin = (request: Request, h: ResponseToolkit) =>
  redirectToWithMemory(request, h, loginPath).takeover()

// Only a well-formed OAuth error response says the refresh token is spent
// (revoked, already used). A network failure or timeout throws something else,
// leaving it unknown whether the session is actually dead.
const isRefreshRejectedByEntra = (error: unknown) =>
  error instanceof ResponseBodyError

const refreshIfNeeded = async (request: Request, session: OidcToken) => {
  const { token, refreshed } = await request.ensureValidToken(session)

  if (!refreshed) {
    return session
  }

  const refreshedSession = { ...session, ...token }
  setAuthSession(request, refreshedSession)

  return refreshedSession
}

const handleRefreshFailure = (
  request: Request,
  h: ResponseToolkit,
  error: unknown
) => {
  if (!isRefreshRejectedByEntra(error)) {
    logger.warn(
      error,
      'Could not refresh the access token, leaving the session in place to retry'
    )
    throw Boom.serverUnavailable('Could not refresh the session')
  }

  logger.warn(error, 'Refresh token rejected, sending the user back to login')
  clearAuthSession(request)

  return redirectToLogin(request, h)
}

/**
 * Turns the tokens saved at the end of the OIDC handshake into hapi
 * credentials, and leaves role checks alone: hapi compares `credentials.scope`
 * against any `auth.scope` a route declares, answering a signed in user who
 * lacks the role with a 403.
 *
 * Registered as a strategy in ./index.ts.
 */
export const sessionScheme = () => ({
  async authenticate(request: Request, h: ResponseToolkit) {
    const session = getAuthSession(request)

    if (!session) {
      return redirectToLogin(request, h)
    }

    try {
      const activeSession = await refreshIfNeeded(request, session)

      return h.authenticated({ credentials: toCredentials(activeSession) })
    } catch (error) {
      return handleRefreshFailure(request, h, error)
    }
  }
})
