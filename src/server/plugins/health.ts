import type { ResponseToolkit, Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'

export const health = {
  plugin: {
    name: 'health',
    register(server: Server) {
      server.route({
        method: 'GET',
        path: '/health',
        options: {
          auth: false
        },
        handler(_request: unknown, h: ResponseToolkit) {
          return h.response({ message: 'success' }).code(statusCodes.ok)
        }
      })
    }
  }
}
