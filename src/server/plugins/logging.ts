import hapiPino from 'hapi-pino'
import type { Request } from '@hapi/hapi'

import { logger } from '../../common/logger.ts'

const pathToIgnore = (_options: unknown, request: Request) =>
  request.path.startsWith('/public') ||
  request.path === '/health' ||
  request.path === '/favicon.ico'

export const logging = {
  plugin: hapiPino,
  options: {
    ignoreFunc: pathToIgnore,
    instance: logger
  }
}
