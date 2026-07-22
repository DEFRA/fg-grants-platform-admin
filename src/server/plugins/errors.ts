import type { Request, ResponseToolkit, Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'

const statusCodeMessages: Record<number, string> = {
  [statusCodes.notFound]: 'Page not found',
  [statusCodes.forbidden]: 'Forbidden',
  [statusCodes.unauthorized]: 'Unauthorized',
  [statusCodes.badRequest]: 'Bad Request'
}

const statusCodeMessage = (statusCode: number) =>
  statusCodeMessages[statusCode] ?? 'Something went wrong'

export const catchAll = (request: Request, h: ResponseToolkit) => {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  const statusCode = response.output.statusCode
  const errorMessage = statusCodeMessage(statusCode)

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response?.stack)
  }

  return h
    .view('error', {
      pageTitle: errorMessage,
      heading: statusCode,
      message: errorMessage
    })
    .code(statusCode)
}

export const errors = {
  plugin: {
    name: 'errors',
    register(server: Server) {
      server.ext('onPreResponse', catchAll)
    }
  }
}
