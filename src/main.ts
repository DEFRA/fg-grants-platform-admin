import process from 'node:process'

import { createServer } from './server/index.ts'
import { config } from './common/config.ts'
import { logger } from './common/logger.ts'
import { operations } from './operations/index.ts'
import { applications } from './applications/index.ts'

export const onUnhandledRejection = (error: unknown) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
}

export const main = async () => {
  const server = await createServer()
  await server.register([operations, applications])
  await server.start()

  logger.info(`Server started at http://localhost:${config.get('port')}`)
}

if (import.meta.main) {
  process.on('unhandledRejection', onUnhandledRejection)

  await main()
}
