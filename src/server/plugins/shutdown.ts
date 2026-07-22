import hapiPulse from 'hapi-pulse'

import { logger } from '../../common/logger.ts'

export const shutdown = {
  plugin: hapiPulse,
  options: {
    logger,
    timeout: 10_000
  }
}
