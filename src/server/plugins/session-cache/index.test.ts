import hapi from '@hapi/hapi'

import { Engine as CatboxRedis } from '@hapi/catbox-redis'
import type { Request, ResponseToolkit } from '@hapi/hapi'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'
import { createRedisClient } from './redis-client.ts'
import { sessionCache } from './index.ts'

vi.mock(import('./redis-client.ts'))
vi.mock(import('@hapi/catbox-redis'))
vi.mock(import('../../../common/config.ts'))
vi.mock(import('../../../common/logger.ts'))

const withSessionCache = async () => {
  const server = hapi.server()
  await server.register(sessionCache)

  return server
}

// Writes a session on one request and reads it back on the next, carrying only
// the cookie between them, exactly as a browser would.
const roundTrip = async (session: object) => {
  const server = await withSessionCache()

  server.route([
    {
      method: 'GET',
      path: '/write',
      handler(request: Request, h: ResponseToolkit) {
        request.yar.set('user', session)

        return h.response('written')
      }
    },
    {
      method: 'GET',
      path: '/read',
      handler: (request: Request) => request.yar.get('user') ?? {}
    }
  ])

  await server.initialize()

  const written = await server.inject('/write')
  const cookie = (written.headers['set-cookie'] as string[])[0].split(';')[0]

  const read = await server.inject({
    method: 'GET',
    url: '/read',
    headers: { cookie }
  })

  await server.stop()

  return { cookie, result: read.result }
}

describe('sessionCache', () => {
  test('reads a written session back on a later request carrying the cookie', async () => {
    const { result } = await roundTrip({ name: 'Ada Lovelace' })

    expect(result).toEqual({ name: 'Ada Lovelace' })
  })

  test('keeps the written session itself out of the cookie', async () => {
    // Large enough that a cookie carrying it would be obvious.
    const { cookie, result } = await roundTrip({
      accessToken: 'a'.repeat(2048)
    })

    expect(result).toEqual({ accessToken: 'a'.repeat(2048) })
    expect(cookie.length).toBeLessThan(500)
  })

  test('backs the cache with the shared Redis client when Redis is configured', async () => {
    const client = {} as ReturnType<typeof createRedisClient>
    vi.mocked(createRedisClient).mockReturnValue(client)

    // Catbox asserts on a null return before it will build a cache policy.
    vi.mocked(CatboxRedis.prototype.validateSegmentName).mockReturnValue(null)

    config.set('session.cache.engine', 'redis')

    await withSessionCache()

    expect(CatboxRedis).toHaveBeenCalledWith({ client })
    expect(logger.info).toHaveBeenCalledWith('Using Redis session cache')
  })

  test('names the in memory cache engine, without warning outside production', async () => {
    await withSessionCache()

    expect(logger.info).toHaveBeenCalledWith(
      'Using Catbox Memory session cache'
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('warns that the in memory cache is unfit for production when running there', async () => {
    config.set('isProduction', true)

    await withSessionCache()

    expect(logger.error).toHaveBeenCalledWith(
      'Catbox Memory is for local development only, it should not be used in production!'
    )
  })
})
