import { ResponseBodyError } from 'openid-client'
import type { Request, ResponseToolkit, Server } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { createServer } from '#/server/server.ts'
import { statusCodes } from '#/server/common/constants/status-codes.ts'
import { roles } from '#/server/auth/roles.ts'
import { setAuthSession } from '#/server/auth/session.ts'

function rejectedByEntra() {
  return new ResponseBodyError('refresh rejected', {
    cause: { error: 'invalid_grant' },
    response: { status: statusCodes.badRequest } as Response
  })
}

function refreshFailedTransiently() {
  return new TypeError('fetch failed')
}

describe('#sessionStrategy refresh failure handling', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()

    server.route({
      method: 'GET',
      path: '/test-sign-in',
      options: { auth: false as const },
      handler(request: Request, h: ResponseToolkit) {
        setAuthSession(request, {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
          claims: { name: 'Ada Lovelace', roles: [roles.grantOperationsAdmin] }
        })

        return h.response('signed in')
      }
    })

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function signIn() {
    const { headers } = await server.inject({
      method: 'GET',
      url: '/test-sign-in'
    })

    return (headers['set-cookie'] as string[] | undefined)
      ?.find((cookie) => cookie.startsWith('session='))
      ?.split(';')[0]
  }

  test('Should respond 503 and keep the session when the refresh fails for a reason other than Entra rejecting it', async () => {
    const cookie = await signIn()

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async () => {
      throw refreshFailedTransiently()
    }

    const failed = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(failed.statusCode).toBe(statusCodes.serviceUnavailable)

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })

    const retried = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(retried.statusCode).toBe(statusCodes.ok)
  })

  test('Should clear the session and redirect to login when Entra rejects the refresh', async () => {
    const cookie = await signIn()

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async () => {
      throw rejectedByEntra()
    }

    const rejected = await server.inject({
      method: 'GET',
      url: '/operations-admin',
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
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(afterClear.statusCode).toBe(statusCodes.found)
    expect(afterClear.headers.location).toBe('/auth/login')
  })
})
