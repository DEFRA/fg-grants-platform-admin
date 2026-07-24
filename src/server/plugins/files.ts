import inert from '@hapi/inert'
import type { Server, ResponseToolkit } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { statusCodes } from '../../common/status-codes.ts'

export const files = {
  plugin: {
    name: 'files',
    async register(server: Server) {
      await server.register([inert])

      if (!config.get('isProduction') && !config.get('isTest')) {
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
      } else {
        server.route([
          {
            options: {
              auth: false,
              cache: {
                expiresIn: config.get('staticCacheTimeout'),
                privacy: 'private'
              }
            },
            method: 'GET',
            path: '/favicon.ico',
            handler(_request: unknown, h: ResponseToolkit) {
              return h
                .response()
                .code(statusCodes.noContent)
                .type('image/x-icon')
            }
          },
          {
            options: {
              auth: false,
              cache: {
                expiresIn: config.get('staticCacheTimeout'),
                privacy: 'private'
              }
            },
            method: 'GET',
            path: `${config.get('assetPath')}/{param*}`,
            handler: {
              directory: {
                path: '.',
                redirectToSlash: true
              }
            }
          }
        ])
      }
    }
  }
}
