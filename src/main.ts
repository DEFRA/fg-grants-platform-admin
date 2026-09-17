import process from 'node:process'

import { createServer } from './server/index.ts'
import { config } from './common/config.ts'
import { logger } from './common/logger.ts'
import { devOps } from './dev-ops/index.ts'
import { grantOps } from './grant-ops/index.ts'
import { home } from './home/index.ts'

// Exported so that a test asking what the app serves can register what the app
// registers, rather than a copy of this list that would drift from it.
export const plugins = [home, devOps, grantOps]

export const onUnhandledRejection = (error: unknown) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
}

export const main = async () => {
  const server = await createServer()
  await server.register(plugins)
  await server.start()

  logger.info(`Server started at http://localhost:${config.get('port')}`)
}

if (import.meta.main) {
  process.on('unhandledRejection', onUnhandledRejection)

  await main()
}
