import type { Server } from '@hapi/hapi'

import { loginCallbackPath, loginPath, logoutPath } from '#/server/auth/oidc.ts'
import {
  loginCallbackController,
  loginController,
  logoutController
} from './controller.ts'

/**
 * Sets up the routes that run the OIDC handshake.
 * These routes are registered in src/server/plugins/router.js.
 */
export const auth = {
  plugin: {
    name: 'auth',
    register(server: Server) {
      server.route([
        {
          method: 'GET',
          path: loginPath,
          ...loginController
        },
        {
          method: ['GET', 'POST'],
          path: loginCallbackPath,
          ...loginCallbackController
        },
        {
          method: 'GET',
          path: logoutPath,
          ...logoutController
        }
      ])
    }
  }
}
