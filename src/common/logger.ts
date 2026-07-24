import { getTraceId } from '@defra/hapi-tracing'
import { ecsFormat } from '@elastic/ecs-pino-format'
import { pino } from 'pino'

import { config } from './config.ts'

const level = config.get('log.level')
const format = {
  ecs: {
    ...ecsFormat({
      serviceVersion: config.get('serviceVersion') ?? undefined,
      serviceName: config.get('serviceName')
    })
  },
  'pino-pretty': {
    transport: {
      target: 'pino-pretty'
    }
  }
}[config.get('log.format')]

const loggerOptions = {
  enabled: config.get('log.enabled'),
  redact: {
    paths: config.get('log.redact'),
    remove: true
  },
  level,
  ...format,
  errorKey: 'error',
  nesting: true,
  mixin() {
    const mixinValues: { 'trace.id'?: string } = {}

    const id = getTraceId()

    if (id) {
      mixinValues['trace.id'] = id
    }

    return mixinValues
  }
}

export const logger = pino(loggerOptions)
