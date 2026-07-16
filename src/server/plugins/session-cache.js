import yar from '@hapi/yar'

import { config } from '#/config/config.js'

const sessionConfig = config.get('session')

/**
 * maxCookieSize 0 always uses server-side storage. Sessions carry OIDC access
 * and refresh tokens, which must not reach the browser, and a session held in
 * the cookie could not be revoked at logout because the old cookie stays
 * replayable.
 */
export const sessionCache = {
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
}
