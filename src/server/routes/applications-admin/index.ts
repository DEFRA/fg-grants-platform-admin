import type { Server } from '@hapi/hapi'

import { applicationsAdminController } from './controller.ts'

/**
 * Sets up the routes used in the /applications-admin page.
 * These routes are registered in src/server/plugins/router.js.
 */
export const applicationsAdmin = {
  plugin: {
    name: 'applications-admin',
    register(server: Server) {
      server.route([
        {
          method: 'GET',
          path: '/applications-admin',
          ...applicationsAdminController
        }
      ])
    }
  }
}
