import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'

describe('viewDevOpsRoute', () => {
  let server: Server

  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/dev-ops'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('renders the dev-ops page for the operations admin role', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops',
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Operations Admin |'))
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('renders the stored dark theme before client javascript runs', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops',
      headers: { cookie: 'dev-ops-theme=dark' },
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(
      expect.stringContaining('<html lang="en" data-theme="dark">')
    )
    expect(result).toEqual(
      expect.stringContaining('value="dark" aria-label="Dark theme" checked>')
    )
  })

  test('ignores an unknown stored theme', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops',
      headers: { cookie: 'dev-ops-theme=synthwave' },
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantOperationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).not.toEqual(expect.stringContaining('data-theme='))
  })

  test('forbids a signed in user holding only the applications admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops',
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('forbids a signed in user holding no roles', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops',
      auth: {
        strategy: 'session',
        credentials: { user: { name: 'Ada Lovelace' }, scope: [] }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })
})
