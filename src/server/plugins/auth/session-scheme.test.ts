import { ResponseBodyError } from 'openid-client'
import type { Request, ResponseToolkit, Server, ServerRoute } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { createServer } from '../../index.ts'
import { statusCodes } from '../../../common/status-codes.ts'
import { getAuthSession, setAuthSession } from './session.ts'

// Stands in for a domain's protected page, so the scheme is tested without
// reaching into a domain module for somewhere to visit.
const protectedRoute: ServerRoute = {
  method: 'GET',
  path: '/protected',
  options: { auth: 'session' },
  handler: (request: Request) => request.auth.credentials.user.name
}

const rejectedByEntra = () =>
  new ResponseBodyError('refresh rejected', {
    cause: { error: 'invalid_grant' },
    response: { status: statusCodes.badRequest } as Response
  })

const refreshFailedTransiently = () => new TypeError('fetch failed')

describe('oidcSessionScheme refresh failure handling', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()

    server.route(protectedRoute)

    server.route({
      method: 'GET',
      path: '/test-sign-in',
      options: { auth: false as const },
      handler(request: Request, h: ResponseToolkit) {
        setAuthSession(request, {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
          claims: { name: 'Ada Lovelace' }
        })

        return h.response('signed in')
      }
    })

    server.route({
      method: 'GET',
      path: '/test-session',
      options: { auth: false as const },
      handler: (request: Request) => getAuthSession(request) ?? {}
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  const signIn = async () => {
    const { headers } = await server.inject({
      method: 'GET',
      url: '/test-sign-in'
    })

    return (headers['set-cookie'] as string[] | undefined)
      ?.find((cookie) => cookie.startsWith('session='))
      ?.split(';')[0]
  }

  test('saves a refreshed token to the session, so the next request reuses it', async () => {
    const cookie = await signIn()

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async () => ({
      token: {
        accessToken: 'refreshed-access-token',
        refreshToken: 'refreshed-refresh-token'
      },
      refreshed: true
    })

    const protectedPage = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie }
    })

    expect(protectedPage.statusCode).toBe(statusCodes.ok)

    const { result } = await server.inject({
      method: 'GET',
      url: '/test-session',
      headers: { cookie }
    })

    expect(result).toEqual({
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      idToken: 'id-token',
      claims: { name: 'Ada Lovelace' }
    })
  })

  test('responds 503 and keeps the session when the refresh fails for a reason other than Entra rejecting it', async () => {
    const cookie = await signIn()

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async () => {
      throw refreshFailedTransiently()
    }

    const failed = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie }
    })

    expect(failed.statusCode).toBe(statusCodes.serviceUnavailable)

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })

    const retried = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie }
    })

    expect(retried.statusCode).toBe(statusCodes.ok)
  })

  test('clears the session and redirects to login when Entra rejects the refresh', async () => {
    const cookie = await signIn()

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async () => {
      throw rejectedByEntra()
    }

    const rejected = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie }
    })

    expect(rejected.statusCode).toBe(statusCodes.found)
    expect(rejected.headers.location).toBe('/auth/login')

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })

    const afterClear = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie }
    })

    expect(afterClear.statusCode).toBe(statusCodes.found)
    expect(afterClear.headers.location).toBe('/auth/login')
  })
})
