import { operationsAdminController } from './controller.js'

/**
 * Sets up the routes used in the /operations-admin page.
 * These routes are registered in src/server/plugins/router.js.
 */
export const operationsAdmin = {
  plugin: {
    name: 'operations-admin',
    register(server) {
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
