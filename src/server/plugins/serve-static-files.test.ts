import type { Server } from '@hapi/hapi'

import { startServer } from '#/server/common/helpers/start-server.ts'
import { statusCodes } from '#/server/common/constants/status-codes.ts'

describe('#serveStaticFiles', () => {
  let server: Server

  describe('When secure context is disabled', () => {
    beforeEach(async () => {
      server = await startServer()
    })

    afterEach(async () => {
      await server.stop({ timeout: 0 })
    })

    test('Should serve favicon as expected', async () => {
      const { statusCode } = await server.inject({
        method: 'GET',
        url: '/favicon.ico'
      })

      expect(statusCode).toBe(statusCodes.noContent)
    })
  })
})
