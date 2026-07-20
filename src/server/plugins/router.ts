import inert from '@hapi/inert'
import type { Server } from '@hapi/hapi'

import { home } from '../routes/home/index.ts'
import { auth } from '../routes/auth/index.ts'
import { operationsAdmin } from '../routes/operations-admin/index.ts'
import { applicationsAdmin } from '../routes/applications-admin/index.ts'
import { health } from '../routes/health/index.ts'
import { serveStaticFiles } from './serve-static-files.ts'
import { config } from '#/config/config.ts'

export const router = {
  plugin: {
    name: 'router',
    async register(server: Server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // OIDC login, callback and logout routes
      await server.register([auth])

      // Application specific routes, add your own routes here
      await server.register([home, operationsAdmin, applicationsAdmin])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          await server.register({
            plugin: (await import('@defra/hapi-connect')).default,
            options: {
              path: '/public',
              middleware: [vite.middlewares]
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
