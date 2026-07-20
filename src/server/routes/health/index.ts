import type { Server } from '@hapi/hapi'

import { healthController } from './controller.ts'

export const health = {
  plugin: {
    name: 'health',
    register(server: Server) {
      server.route({
        method: 'GET',
        path: '/health',
        ...healthController
      })
    }
  }
}
