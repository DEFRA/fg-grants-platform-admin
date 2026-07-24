import { Cluster, Redis } from 'ioredis'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'
import { createRedisClient } from './redis-client.ts'

vi.mock(import('ioredis'))
vi.mock(import('../../../common/config.ts'))
vi.mock(import('../../../common/logger.ts'))

const handlerFor = (client: Redis | Cluster, event: string) => {
  const [, handler] = vi
    .mocked(client.on)
    .mock.calls.find(([name]) => name === event) as [
    string,
    (error?: Error) => void
  ]

  return handler
}

describe('createRedisClient', () => {
  beforeEach(() => {
    config.set('redis.keyPrefix', 'test:')
    config.set('redis.useSingleInstanceCache', true)
  })

  test('creates a Redis client from the configured single instance connection', () => {
    expect(createRedisClient()).toBeInstanceOf(Redis)

    expect(Redis).toHaveBeenCalledWith({
      port: 6379,
      host: '127.0.0.1',
      keyPrefix: 'test:',
      db: 0
    })
  })

  test('creates a Cluster client from the configured cluster connection', () => {
    config.set('redis.username', 'testuser')
    config.set('redis.password', 'testpassword')
    config.set('redis.useSingleInstanceCache', false)

    expect(createRedisClient()).toBeInstanceOf(Cluster)

    expect(Cluster).toHaveBeenCalledWith(
      [
        {
          port: 6379,
          host: '127.0.0.1'
        }
      ],
      {
        keyPrefix: 'test:',
        slotsRefreshTimeout: 10000,
        dnsLookup: expect.any(Function),
        redisOptions: {
          db: 0,
          tls: {},
          username: 'testuser',
          password: 'testpassword'
        }
      }
    )
  })

  test('dials a cluster node at the address the cluster named, without a further lookup', () => {
    config.set('redis.useSingleInstanceCache', false)

    createRedisClient()

    const [, options] = vi.mocked(Cluster).mock.calls[0]
    const dialled = vi.fn()

    options?.dnsLookup?.('node.cache.amazonaws.com', dialled)

    expect(dialled).toHaveBeenCalledWith(null, 'node.cache.amazonaws.com')
  })

  test('logs once connected', () => {
    handlerFor(createRedisClient(), 'connect')()

    expect(logger.info).toHaveBeenCalledWith('Connected to Redis')
  })

  test('logs a failure to connect', () => {
    const error = new Error('Connection failed')

    handlerFor(createRedisClient(), 'error')(error)

    expect(logger.error).toHaveBeenCalledWith(
      `Failed to connect to Redis: ${error}`
    )
  })
})
