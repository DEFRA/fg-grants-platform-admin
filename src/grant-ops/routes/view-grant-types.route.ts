import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

import { isCaseworkingRolesUnavailable } from '../use-cases/gas-refusal.ts'
import { getGrantTypesUseCase } from '../use-cases/get-grant-types.use-case.ts'
import { toGrantTypesPage } from '../view-models/grant-types-page.view-model.ts'
import {
  rolesUnavailablePage,
  rolesUnavailableStatusCode
} from '../view-models/roles-unavailable-page.view-model.ts'

const viewRolesUnavailable = (h: ResponseToolkit) =>
  h
    .view('roles-unavailable', rolesUnavailablePage)
    .code(rolesUnavailableStatusCode)

/** GAS answers a 503 naming the roles lookup when it cannot tell which grants the operator administers; anything else goes to the error page. */
const respondToFailure = (h: ResponseToolkit, error: unknown) => {
  if (isCaseworkingRolesUnavailable(error)) {
    return viewRolesUnavailable(h)
  }

  throw error
}

export const viewGrantTypesRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants',
  async handler(_request: Request, h: ResponseToolkit) {
    try {
      const { grantTypes } = await getGrantTypesUseCase()

      return h.view('grant-types', toGrantTypesPage(grantTypes))
    } catch (error) {
      return respondToFailure(h, error)
    }
  }
}
