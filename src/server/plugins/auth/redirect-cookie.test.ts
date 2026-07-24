import type { Request, ResponseToolkit, Server } from '@hapi/hapi'
import type { OutgoingHttpHeaders } from 'node:http'

import { createServer } from '../../index.ts'
import { statusCodes } from '../../../common/status-codes.ts'
import { redirectCookieName } from './redirect-cookie.ts'

vi.mock(import('../../../common/config.ts'))

// The cookie is shaped as the module loads, against the security setting the
// deployment runs under, so each case takes a fresh copy of it.
const loadCookieOptions = async (secure: boolean) => {
  vi.resetModules()

  const { config } = await import('../../../common/config.ts')
  config.set('session.cookie.secure', secure)

  const { redirectCookieOptions } = await import('./redirect-cookie.ts')

  return redirectCookieOptions
}

const getCookie = (headers: OutgoingHttpHeaders, name: string) =>
  (headers['set-cookie'] as string[])
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]

describe('takeRedirectTo', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()

    server.route({
      method: 'GET',
      path: '/test-remember',
      options: { auth: false as const },
      handler: (request: Request, h: ResponseToolkit) =>
        h
          .response('remembered')
          .state(redirectCookieName, String(request.query.to))
    })

    await server.initialize()

    server.plugins['hapi-auth-oidc'].oidc.callback = async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: { name: 'Ada Lovelace' }
    })
  })

  afterAll(async () => {
    await server.stop()
  })

  const callbackAfterRemembering = async (destination: string) => {
    const remembered = await server.inject({
      method: 'GET',
      url: `/test-remember?to=${encodeURIComponent(destination)}`
    })

    const cookie = getCookie(remembered.headers, redirectCookieName)

    return server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie }
    })
  }

  test('returns the user to the page they were heading for', async () => {
    const { statusCode, headers } = await callbackAfterRemembering(
      '/operations?ref=email'
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/operations?ref=email')
  })

  test.each([
    ['a protocol relative url', '//evil.example/phish'],
    ['an absolute url', 'https://evil.example/phish'],
    ['a backslashed protocol relative url', '/\\evil.example'],
    ['a path that is not rooted', 'operations']
  ])('sends the user home rather than to %s', async (_name, destination) => {
    const { statusCode, headers } = await callbackAfterRemembering(destination)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/')
  })

  test('sends the user home when nothing was remembered', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/')
  })

  test('spends the remembered page, clearing the cookie', async () => {
    const remembered = await server.inject({
      method: 'GET',
      url: '/test-remember?to=/operations'
    })

    const cookie = getCookie(remembered.headers, redirectCookieName)

    const { headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie }
    })

    expect(headers.location).toBe('/operations')
    expect(getCookie(headers, redirectCookieName)).toBe(
      `${redirectCookieName}=`
    )
  })
})

describe('redirectCookieOptions', () => {
  // Entra returns the user by a cross-site form post, which a browser only
  // sends the cookie on when it is SameSite=None, and only honours that on a
  // Secure one.
  test('relaxes SameSite for the cross-site return over https', async () => {
    await expect(loadCookieOptions(true)).resolves.toMatchObject({
      isSecure: true,
      isSameSite: 'None'
    })
  })

  test('keeps SameSite strict enough for the same-site return over http', async () => {
    await expect(loadCookieOptions(false)).resolves.toMatchObject({
      isSecure: false,
      isSameSite: 'Lax'
    })
  })

  // Iron encoding is what stops the destination being rewritten into one
  // leaving the service, and the ttl what stops a stale one being honoured.
  test('keeps the destination tamper proof, unreadable to scripts and short lived', async () => {
    await expect(loadCookieOptions(true)).resolves.toMatchObject({
      encoding: 'iron',
      isHttpOnly: true,
      ttl: 600_000,
      path: '/',
      clearInvalid: true,
      ignoreErrors: true
    })
  })
})
