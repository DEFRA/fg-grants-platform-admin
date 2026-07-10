import { ResponseBodyError } from 'openid-client'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { roles } from '#/server/auth/roles.js'
import { setAuthSession } from '#/server/auth/session.js'

function rejectedByEntra() {
  return new ResponseBodyError('refresh rejected', {
    cause: { error: 'invalid_grant' },
    response: { status: statusCodes.badRequest }
  })
}

function refreshFailedTransiently() {
  return new TypeError('fetch failed')
}

describe('#sessionStrategy refresh failure handling', () => {
  let server

  beforeAll(async () => {
    server = await createServer()

    server.route({
      method: 'GET',
      path: '/test-sign-in',
      options: { auth: false },
      handler(request, h) {
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

    return headers['set-cookie']
      .find((cookie) => cookie.startsWith('session='))
      .split(';')[0]
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
      _request,
      token
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
      _request,
      token
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
