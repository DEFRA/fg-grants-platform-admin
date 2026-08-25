import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import { viewNewClaimableItemUseCase } from '../use-cases/view-new-claimable-item.use-case.ts'
import Joi from 'joi'

interface ClaimableItemParams {
  code: string
  clientRef: string
  claimCode: string
}

export const newClaimableItemRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims/entitlements/{claimCode}',
  options: {
    auth: {
      strategy: 'session',
      scope: ['FCP.GrantOperationsAdmin']
    },
    validate: {
      params: Joi.object({
        code: Joi.string().required(),
        clientRef: Joi.string().required(),
        claimCode: Joi.string().required()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, clientRef, claimCode } =
      request.params as unknown as ClaimableItemParams

    const {
      availableEntitlements,
      claimableEntitlements,
      claims,
      claimableTemplate
    } = await viewNewClaimableItemUseCase(code, clientRef, claimCode)

    return h.view('new-claimable-item', {
      pageTitle: 'New Claimable Item',
      heading: 'New Claimable Item',
      code,
      clientRef,
      availableEntitlements,
      claimableEntitlements,
      claimableTemplate,
      claims
    })
  }
}
