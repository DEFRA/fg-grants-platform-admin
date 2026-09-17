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

  test('sends an operations admin on to the events page, temporarily', async () => {
    const { statusCode, headers } = await server.inject({
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

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/dev-ops/events')
  })
})
