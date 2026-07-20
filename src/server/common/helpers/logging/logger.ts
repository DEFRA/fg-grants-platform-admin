import { pino } from 'pino'

import { loggerOptions } from '../../../plugins/logger-options.ts'

const logger = pino(loggerOptions)

function createLogger() {
  return logger
}

export { createLogger }
