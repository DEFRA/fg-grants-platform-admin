import type { Boom } from '@hapi/boom'
import type { Request, ResponseToolkit } from '@hapi/hapi'

import { logErrorResponse } from '../server/plugins/errors.ts'

import { toStatusPage, toStatusState } from './view-models/status-page.ts'

const isBoom = (response: Request['response']): response is Boom =>
  'isBoom' in response && response.isBoom

const toStatusView = (request: Request, h: ResponseToolkit, response: Boom) => {
  const { statusCode } = response.output
  const state = toStatusState(statusCode, response.message)

  logErrorResponse(request, response)

  return h
    .view('status', toStatusPage(request, statusCode, state))
    .code(statusCode)
}

/**
 * Dev Ops' own pages for an error on one of its routes, drawn in its shell
 * rather than as the GOV.UK pages the rest of the app answers with. It runs
 * before the app's errors plugin, which then finds no error left to draw, so
 * the logging that plugin would have done is done here.
 */
export const toStatusResponse = (request: Request, h: ResponseToolkit) => {
  const { response } = request

  return isBoom(response) ? toStatusView(request, h, response) : h.continue
}
