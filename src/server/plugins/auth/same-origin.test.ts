import hapi from '@hapi/hapi'
import type { Request, Server } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../../common/config.ts'
import { roles } from '../../../common/roles.ts'
import { statusCodes } from '../../../common/status-codes.ts'
import { plugins } from '../../../main.ts'
import { createServer } from '../../index.ts'
import { loginCallbackPath } from './paths.ts'
import { isSameOrigin, sameOrigin } from './same-origin.ts'

const app = new URL(config.get('auth.appBaseUrl')).origin

describe('isSameOrigin', () => {
  test.each([
    [
      'same-origin, with the app origin',
      { 'sec-fetch-site': 'same-origin', origin: app }
    ],
    ['same-origin, with no origin', { 'sec-fetch-site': 'same-origin' }],
    [
      'the app origin, from a browser that sends no Sec-Fetch-Site',
      { origin: app }
    ]
  ])('accepts %s', (_name, headers) => {
    expect(isSameOrigin(headers)).toBe(true)
  })

  test.each([
    [
      'a cross-site request',
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }
    ],
    [
      'a same-site request from a sibling frontend',
      {
        'sec-fetch-site': 'same-site',
        origin: 'https://other.cdp-int.defra.cloud'
      }
    ],
    ['a request with neither header', {}],
    [
      'another origin, with no Sec-Fetch-Site',
      { origin: 'https://evil.example' }
    ],
    ['the app origin on a different port', { origin: `${app}1` }],
    ['a null origin', { origin: 'null' }],
    [
      'headers that disagree',
      { 'sec-fetch-site': 'same-origin', origin: 'https://evil.example' }
    ],
    ['a navigation typed into the address bar', { 'sec-fetch-site': 'none' }]
  ])('refuses %s', (_name, headers) => {
    expect(isSameOrigin(headers)).toBe(false)
  })
})

describe('sameOrigin', () => {
  const handler = vi.fn((request: Request) => request.pre.later)
  const server = hapi.server()

  beforeAll(async () => {
    await server.register(sameOrigin)
    server.route([
      {
        method: ['POST', 'PUT', 'PATCH', 'DELETE'],
        path: '/write',
        options: {
          pre: [{ method: () => 'later', assign: 'later' }],
          validate: { payload: Joi.object({ name: Joi.string().required() }) }
        },
        handler
      },
      { method: 'GET', path: '/read', handler: () => 'read' },
      {
        method: 'POST',
        path: '/elsewhere',
        options: { plugins: { sameOrigin: { crossOrigin: true } } },
        handler: () => 'taken'
      }
    ])
    await server.initialize()
  })

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses a cross-site %s before its handler runs',
    async (method) => {
      const { statusCode } = await server.inject({
        method,
        url: '/write',
        headers: { 'sec-fetch-site': 'cross-site' }
      })

      expect(statusCode).toBe(403)
      expect(handler).not.toHaveBeenCalled()
    }
  )

  test('refuses a write that names no origin at all', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/write'
    })

    expect(statusCode).toBe(403)
  })

  test('refuses a cross-site write before it validates the payload', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/write',
      payload: {},
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(403)
  })

  test('lets a same-origin write through, still running its own steps', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/write',
      payload: { name: 'Ada' },
      headers: { 'sec-fetch-site': 'same-origin' }
    })

    expect(statusCode).toBe(200)
    expect(result).toBe('later')
  })

  test.each(['GET', 'HEAD'])('leaves a cross-site %s alone', async (method) => {
    const { statusCode } = await server.inject({
      method,
      url: '/read',
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(200)
  })

  test('lets a cross-site write through to a route that takes one', async () => {
    const { result } = await server.inject({
      method: 'POST',
      url: '/elsewhere',
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(result).toBe('taken')
  })
})

describe('the app', () => {
  let app: Server

  const writes = () =>
    app.table().filter(({ method }) => !['get', 'head'].includes(method))

  beforeAll(async () => {
    app = await createServer()
    await app.register(plugins)
    await app.initialize()
  })

  afterAll(async () => {
    await app.stop()
  })

  test('takes a write from another origin only at the Entra ID callback', () => {
    const open = writes()
      .filter(({ settings }) => settings.plugins?.sameOrigin?.crossOrigin)
      .map(({ method, path }) => `${method} ${path}`)

    expect(open).toEqual([`post ${loginCallbackPath}`])
  })

  test('refuses a cross-site request to every other write it serves', async () => {
    const guarded = writes().filter(({ path }) => path !== loginCallbackPath)
    const given = await Promise.all(
      guarded.map(async ({ method, path }) => {
        const { statusCode } = await app.inject({
          method,
          url: path.replace(/\{[^}]+\}/g, 'x'),
          headers: { 'sec-fetch-site': 'same-site' },
          auth: {
            strategy: 'session',
            credentials: {
              user: { name: 'Ada Lovelace' },
              scope: Object.values(roles)
            }
          }
        })

        return { route: `${method} ${path}`, statusCode }
      })
    )

    expect(guarded.some(({ path }) => path.startsWith('/grant-ops/'))).toBe(
      true
    )
    expect(given).toEqual(
      given.map(({ route }) => ({ route, statusCode: statusCodes.forbidden }))
    )
  })
})
