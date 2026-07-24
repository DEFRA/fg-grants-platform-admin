import path from 'path'
import hapi from '@hapi/hapi'
import Scooter from '@hapi/scooter'

import { files } from './plugins/files.ts'
import { config } from '../common/config.ts'
import { errors } from './plugins/errors.ts'
import { health } from './plugins/health.ts'
import { shutdown } from './plugins/shutdown.ts'
import { views } from './plugins/views/index.ts'
import { tracing } from './plugins/tracing.ts'
import { logging } from './plugins/logging.ts'
import { sessionCache } from './plugins/session-cache/index.ts'
import { auth } from './plugins/auth/index.ts'
import { secureContext } from '@defra/hapi-secure-context'
import { contentSecurityPolicy } from './plugins/content-security-policy.ts'
import { metrics } from '@defra/cdp-metrics'

export const createServer = async () => {
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
    state: {
      strictHeader: false
    }
  })

  await server.register([
    health,
    logging,
    tracing,
    metrics,
    secureContext,
    shutdown,
    sessionCache,
    views,
    Scooter,
    contentSecurityPolicy,
    errors,
    auth,
    files
  ])

  return server
}
