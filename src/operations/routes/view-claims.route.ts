import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'

interface ClaimsParams {
  code: string
  clientRef: string
}

export const viewClaimsRoute: ServerRoute = {
  method: 'GET',
  path: '/operations/grants/{code}/applications/{clientRef}/claims',
  options: {
    auth: {
      strategy: 'session',
      scope: ['FCP.GrantOperationsAdmin']
    },
    validate: {
      params: Joi.object({
        code: Joi.string().required(),
        clientRef: Joi.string().required()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, clientRef } = request.params as unknown as ClaimsParams

    const { availableEntitlements, claimableEntitlements, claims } =
      await getClaimsUseCase(code, clientRef)

    return h.view('claims', {
      pageTitle: `Claims for ${clientRef}`,
      heading: 'Claims',
      code,
      clientRef,
      availableEntitlements,
      claimableEntitlements,
      claims
    })
  }
}
