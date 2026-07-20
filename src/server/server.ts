import path from 'path'
import hapi from '@hapi/hapi'
import Scooter from '@hapi/scooter'

import { router } from './plugins/router.ts'
import { config } from '#/config/config.ts'
import { pulse } from './plugins/pulse.ts'
import { catchAll } from './common/helpers/errors.ts'
import { nunjucksConfig } from '#/config/nunjucks/nunjucks.ts'
import { requestTracing } from './plugins/request-tracing.ts'
import { requestLogger } from './plugins/request-logger.ts'
import { sessionCache } from './plugins/session-cache.ts'
import { oidc } from './auth/oidc.ts'
import { sessionStrategy } from './auth/session-strategy.ts'
import { getCacheEngine } from './common/helpers/session-cache/cache-engine.ts'
import { secureContext } from '@defra/hapi-secure-context'
import { contentSecurityPolicy } from './plugins/content-security-policy.ts'
import { metrics } from '@defra/cdp-metrics'

export async function createServer() {
  const server = hapi.server({
    host: config.get('host'),
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        }
      },
      files: {
        relativeTo: path.resolve(config.get('root'), '.public')
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    },
    cache: [
      {
        name: config.get('session.cache.name'),
        engine: getCacheEngine(config.get('session.cache.engine'))
      }
    ],
    state: {
      strictHeader: false
    }
  })
  await server.register([
    requestLogger,
    requestTracing,
    metrics,
    secureContext,
    pulse,
    sessionCache,
    nunjucksConfig,
    Scooter,
    contentSecurityPolicy,
    oidc,
    // Must precede the router: routes name the `session` strategy it registers.
    sessionStrategy,
    router // Register all the controllers/routes defined in src/server/router.js
  ])

  server.ext('onPreResponse', catchAll)

  return server
}
