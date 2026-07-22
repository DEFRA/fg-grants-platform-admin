import yar from '@hapi/yar'
import { Engine as CatboxRedis } from '@hapi/catbox-redis'
import { Engine as CatboxMemory } from '@hapi/catbox-memory'
import type { Server } from '@hapi/hapi'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'
import { createRedisClient } from './redis-client.ts'

const getCacheEngine = (engine?: string) => {
  if (engine === 'redis') {
    logger.info('Using Redis session cache')
    return new CatboxRedis({ client: createRedisClient() })
  }

  if (config.get('isProduction')) {
    logger.error(
      'Catbox Memory is for local development only, it should not be used in production!'
    )
  }

  logger.info('Using Catbox Memory session cache')
  return new CatboxMemory()
}

/**
 * Server side session storage, and the cache it is written to. Provisioning has
 * to complete before yar registers, since yar builds its cache policy against
 * the named cache as it registers.
 *
 * `maxCookieSize: 0` forces server-side storage. Sessions carry OIDC access and
 * refresh tokens, which must not reach the browser, and a session held in the
 * cookie could not be revoked at logout because the old cookie stays
 * replayable.
 */
export const sessionCache = {
  plugin: {
    name: 'session-cache',
    async register(server: Server) {
      const sessionConfig = config.get('session')

      await server.cache.provision({
        name: sessionConfig.cache.name,
        engine: getCacheEngine(sessionConfig.cache.engine)
      })

      await server.register({
        plugin: yar,
        options: {
          name: sessionConfig.cache.name,
          maxCookieSize: 0,
          cache: {
            cache: sessionConfig.cache.name,
            expiresIn: sessionConfig.cache.ttl
          },
          storeBlank: false,
          errorOnCacheNotReady: true,
          cookieOptions: {
            password: sessionConfig.cookie.password,
            ttl: sessionConfig.cookie.ttl,
            isSecure: config.get('session.cookie.secure'),
            clearInvalid: true
          }
        }
      })
    }
  }
}
