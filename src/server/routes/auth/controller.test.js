import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { roles } from '#/server/auth/roles.js'
import { redirectCookieName } from '#/server/auth/oidc.js'

function cookieNamed(headers, name) {
  return headers['set-cookie']
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
}

describe('#authController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()

    // Stands in for the code-for-token exchange with Entra ID.
    server.plugins['hapi-auth-oidc'].oidc.callback = async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: { name: 'Ada Lovelace', roles: [roles.grantOperationsAdmin] }
    })
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should remember the requested page across the login round trip', async () => {
    const protectedPage = await server.inject({
      method: 'GET',
      url: '/operations-admin?ref=email'
    })

    const redirectCookie = cookieNamed(
      protectedPage.headers,
      redirectCookieName
    )
    expect(redirectCookie).toBeDefined()

    // Entra ID posts the user back cross-site, so the cookie must not be Lax.
    const rawCookie = protectedPage.headers['set-cookie'].find((cookie) =>
      cookie.startsWith(`${redirectCookieName}=`)
    )
    expect(rawCookie).toEqual(expect.stringContaining('HttpOnly'))

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie: redirectCookie }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/operations-admin?ref=email')
  })

  test('Should land on the home page when no page was requested', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/')
  })

  test('Should sign the user in, granting access to the protected page', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = cookieNamed(callback.headers, 'session')

    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request,
      token
    ) => ({ token, refreshed: false })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie: sessionCookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('Should clear the session on logout', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = cookieNamed(callback.headers, 'session')

    const logout = await server.inject({
      method: 'GET',
      url: '/auth/logout',
      headers: { cookie: sessionCookie }
    })

    expect(logout.statusCode).toBe(statusCodes.found)
    expect(logout.headers.location).toBe('/')

    const afterLogout = await server.inject({
      method: 'GET',
      url: '/operations-admin',
      headers: { cookie: sessionCookie }
    })

    expect(afterLogout.statusCode).toBe(statusCodes.found)
    expect(afterLogout.headers.location).toBe('/auth/login')
  })
})
