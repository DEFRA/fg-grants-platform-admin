import type { Server } from '@hapi/hapi'

import { operationsAdminController } from './controller.ts'

/**
 * Sets up the routes used in the /operations-admin page.
 * These routes are registered in src/server/plugins/router.js.
 */
export const operationsAdmin = {
  plugin: {
    name: 'operations-admin',
    register(server: Server) {
      server.route([
        {
          method: 'GET',
          path: '/operations-admin',
          ...operationsAdminController
        }
      ])
    }
  }
}
