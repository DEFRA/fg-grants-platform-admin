import type { ResponseToolkit } from '@hapi/hapi'

import { statusCodes } from '#/server/common/constants/status-codes.ts'

/**
 * A generic health-check endpoint. Used by the platform to check if the service is up and handling requests.
 */
export const healthController = {
  handler(_request: unknown, h: ResponseToolkit) {
    return h.response({ message: 'success' }).code(statusCodes.ok)
  }
}
