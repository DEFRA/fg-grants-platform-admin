import hapiPino from 'hapi-pino'
import type { Request } from '@hapi/hapi'

import { loggerOptions } from './logger-options.ts'

const pathToIgnore = (_options: unknown, request: Request) =>
  request.path.startsWith('/public') ||
  request.path === '/health' ||
  request.path === '/favicon.ico'

const requestLogger = {
  plugin: hapiPino,
  options: {
    ignoreFunc: pathToIgnore,
    ...loggerOptions
  }
}

export { requestLogger }
