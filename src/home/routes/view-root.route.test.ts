import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { home } from '../index.ts'

const user = { name: 'Ada Lovelace' }

let server: Server

const visit = (scope?: string[]) =>
  server.inject({
    method: 'GET',
    url: '/',
    ...(scope && {
      auth: { strategy: 'session', credentials: { user, scope } }
    })
  })

describe('viewRootRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([home])
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test.each([
    ['an operations admin', ['FCP.GrantOperationsAdmin'], '/dev-ops'],
    ['an applications admin', ['FCP.GrantApplicationsAdmin'], '/grant-ops'],
    // Applications Admin first in the token, so this fails if the answer
    // comes from the order the roles arrive in rather than the route's own.
    [
      'a user holding both roles',
      ['FCP.GrantApplicationsAdmin', 'FCP.GrantOperationsAdmin'],
      '/dev-ops'
    ]
  ])('sends %s to their own area', async (_name, scope, entrance) => {
    const { statusCode, headers } = await visit(scope)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(entrance)
  })

  test('sends an anonymous visitor to sign in', async () => {
    const { statusCode, headers } = await visit()

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('shows the refusal page to a signed in user holding no roles', async () => {
    const { statusCode, payload } = await visit([])

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(payload).toContain(
      'You do not have access to this part of the service'
    )
  })
})
