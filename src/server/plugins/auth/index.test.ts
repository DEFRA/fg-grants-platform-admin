import type { Request, ResponseToolkit, Server, ServerRoute } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'
import type { OutgoingHttpHeaders } from 'node:http'

import { createServer } from '../../index.ts'
import { statusCodes } from '../../../common/status-codes.ts'
import { redirectCookieName } from './redirect-cookie.ts'

const protectedRoute: ServerRoute = {
  method: 'GET',
  path: '/protected',
  options: { auth: 'session' },
  handler: (request: Request) => request.auth.credentials.user.name
}

const getCookie = (headers: OutgoingHttpHeaders, name: string) =>
  (headers['set-cookie'] as string[])
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]

describe('auth', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    server.route(protectedRoute)
    await server.initialize()

    // Stands in for the code-for-token exchange with Entra ID.
    server.plugins['hapi-auth-oidc'].oidc.callback = async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: { name: 'Ada Lovelace' }
    })

    // Refreshing against Entra ID is ./session-scheme.test.ts's subject, not
    // this file's.
    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })
  })

  afterAll(async () => {
    await server.stop()
  })

  test('hands an anonymous user at the login path to the identity provider', async () => {
    const authorizeUrl = 'https://login.microsoftonline.com/authorize'

    server.plugins['hapi-auth-oidc'].oidc.login = async (
      _request: Request,
      h: ResponseToolkit
    ) => h.redirect(authorizeUrl)

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(authorizeUrl)
  })

  test('remembers the requested page across the login round trip', async () => {
    const protectedPage = await server.inject({
      method: 'GET',
      url: '/protected?ref=email'
    })

    const redirectCookie = getCookie(protectedPage.headers, redirectCookieName)
    expect(redirectCookie).toBeDefined()

    const rawCookie = (protectedPage.headers['set-cookie'] as string[]).find(
      (cookie) => cookie.startsWith(`${redirectCookieName}=`)
    )
    expect(rawCookie).toEqual(expect.stringContaining('HttpOnly'))

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie: redirectCookie }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/protected?ref=email')
  })

  test('lands on the home page when no page was requested', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/')
  })

  test('signs the user in, granting access to the protected page', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = getCookie(callback.headers, 'session')

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: sessionCookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('clears the session on logout', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = getCookie(callback.headers, 'session')

    const logout = await server.inject({
      method: 'GET',
      url: '/auth/logout',
      headers: { cookie: sessionCookie }
    })

    expect(logout.statusCode).toBe(statusCodes.found)
    expect(logout.headers.location).toBe('/')

    const afterLogout = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: sessionCookie }
    })

    expect(afterLogout.statusCode).toBe(statusCodes.found)
    expect(afterLogout.headers.location).toBe('/auth/login')
  })
})
