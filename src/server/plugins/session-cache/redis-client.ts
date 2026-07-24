import { Cluster, Redis } from 'ioredis'

import { config } from '../../../common/config.ts'
import { logger } from '../../../common/logger.ts'

const db = 0

export const createRedisClient = () => {
  const client = config.get('redis.useSingleInstanceCache')
    ? new Redis({
        port: config.get('redis.port'),
        host: config.get('redis.host'),
        keyPrefix: config.get('redis.keyPrefix'),
        db
      })
    : new Cluster(
        [
          {
            port: config.get('redis.port'),
            host: config.get('redis.host')
          }
        ],
        {
          keyPrefix: config.get('redis.keyPrefix'),
          slotsRefreshTimeout: 10000,
          dnsLookup(address, callback) {
            callback(null, address)
          },
          redisOptions: {
            db,
            tls: {},
            username: config.get('redis.username'),
            password: config.get('redis.password')
          }
        }
      )

  client.on('error', (error) => {
    logger.error(`Failed to connect to Redis: ${error}`)
  })

  client.on('connect', () => {
    logger.info('Connected to Redis')
  })

  return client
}
