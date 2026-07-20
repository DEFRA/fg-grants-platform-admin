import process from 'node:process'

import { startServer } from '#/server/common/helpers/start-server.ts'
import { createLogger } from '#/server/common/helpers/logging/logger.ts'

await startServer()

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
