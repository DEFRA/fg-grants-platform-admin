import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { roles } from '#/server/auth/roles.js'
import { setAuthSession } from '#/server/auth/session.js'

/**
 * Signs a user in without talking to Entra ID, by writing the session the OIDC
 * callback would have written and reusing the cookie yar hands back.
 */
async function signIn(server, claims) {
  const { headers } = await server.inject({
    method: 'GET',
    url: `/test-sign-in?claims=${encodeURIComponent(JSON.stringify(claims))}`
  })

  const sessionCookie = headers['set-cookie']
    .find((cookie) => cookie.startsWith('session='))
    .split(';')[0]

  return { cookie: sessionCookie }
}

describe('#operationsAdminController', () => {
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
          claims: JSON.parse(request.query.claims)
        })

        return h.response('signed in')
      }
    })

    await server.initialize()

    // The real decoration refreshes the access token against Entra ID. Route
    // protection is what is under test here, not the refresh itself.
    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request,
      token
    ) => ({ token, refreshed: false })
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should redirect an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/operations-admin'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('Should provide expected response for the operations admin role', async () => {
    const { cookie } = await signIn(server, {
      name: 'Ada Lovelace',
      roles: [roles.grantOperationsAdmin]
    })

    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Operations Admin |'))
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('Should forbid a signed in user holding only the applications admin role', async () => {
    const { cookie } = await signIn(server, {
      name: 'Ada Lovelace',
      roles: [roles.grantApplicationsAdmin]
    })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('Should forbid a signed in user holding no roles', async () => {
    const { cookie } = await signIn(server, { name: 'Ada Lovelace' })

    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })
})
