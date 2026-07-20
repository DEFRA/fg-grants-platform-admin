import type { Server } from '@hapi/hapi'

import { homeController } from './controller.ts'

/**
 * Sets up the routes used in the home page.
 * These routes are registered in src/server/router.js.
 */
export const home = {
  plugin: {
    name: 'home',
    register(server: Server) {
      server.route([
        {
          method: 'GET',
          path: '/',
          ...homeController
        }
      ])
    }
  }
}
