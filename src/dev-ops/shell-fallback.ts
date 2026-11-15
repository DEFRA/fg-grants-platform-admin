import type { Request, ResponseObject, ResponseToolkit } from '@hapi/hapi'
import type { Boom } from '@hapi/boom'

import { asGasActor, toGasActor } from '../common/gas-actor.ts'
import { roles } from '../common/roles.ts'
import { statusCodes } from '../common/status-codes.ts'
import { readShellUseCase } from './use-cases/shell-catalogue.ts'
import { upstreamOf, withUpstream } from './upstream.ts'

const statusOf = (response: Boom | ResponseObject): number | null => {
  if ('isBoom' in response && response.isBoom) {
    return response.output.statusCode
  }

  const drawn = response as ResponseObject

  // Vision's own variety, which hapi's types do not list.
  return (drawn.variety as string) === 'view' ? drawn.statusCode : null
}

/** A page, a status page among them, below 500: a redirect draws nothing, and a 500 asks nothing more of GAS. */
const isPageBelow500 = (request: Request): boolean => {
  const status = statusOf(request.response)

  return status !== null && status < statusCodes.internalServerError
}

const isOperator = ({ auth }: Request): boolean =>
  [auth.credentials?.scope ?? []].flat().includes(roles.grantOperationsAdmin)

const needsShell = (request: Request): boolean => {
  const { calls, shell } = upstreamOf(request)

  return (
    calls === 0 &&
    shell === null &&
    isOperator(request) &&
    isPageBelow500(request)
  )
}

/**
 * A page drawn without asking GAS anything, a 404 among them, asks it for the
 * shell alone. One whose call failed with no answer to carry it draws no lists
 * rather than asking again.
 */
export const fetchMissingShell = async (
  request: Request,
  h: ResponseToolkit
) => {
  if (needsShell(request)) {
    await asGasActor(toGasActor(request), () =>
      withUpstream(request, readShellUseCase)
    )
  }

  return h.continue
}
