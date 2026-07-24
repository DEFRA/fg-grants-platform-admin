import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { applications } from '../index.ts'

describe('viewApplicationsRoute', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.register([applications])
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/applications'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('renders the applications page for the applications admin role', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/applications',
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Applications Admin |'))
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('forbids a signed in user holding only the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/applications',
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('forbids a signed in user holding no roles', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/applications',
      auth: {
        strategy: 'session',
        credentials: { user: { name: 'Ada Lovelace' }, scope: [] }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })
})
