import { applicationsAdminController } from './controller.js'

/**
 * Sets up the routes used in the /applications-admin page.
 * These routes are registered in src/server/plugins/router.js.
 */
export const applicationsAdmin = {
  plugin: {
    name: 'applications-admin',
    register(server) {
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
