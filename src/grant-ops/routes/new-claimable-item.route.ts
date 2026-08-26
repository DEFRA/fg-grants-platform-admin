import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import { createClaimableItemUseCase } from '../use-cases/create-claimable-item.use-case.ts'
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

    const { availableEntitlements, claimableTemplate } =
      await viewNewClaimableItemUseCase(code, clientRef, claimCode)

    return h.view('new-claimable-item', {
      pageTitle: 'New Claimable Item',
      heading: 'New Claimable Item',
      code,
      clientRef,
      availableEntitlements,
      claimableTemplate
    })
  }
}

export const createClaimableItemRoute: ServerRoute = {
  method: 'POST',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims/entitlements/{claimCode}',
  options: {
    validate: {
      params: Joi.object({
        code: Joi.string().required(),
        clientRef: Joi.string().required(),
        claimCode: Joi.string().required()
      }),
      payload: Joi.object().pattern(Joi.string(), Joi.string())
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, clientRef, claimCode } =
      request.params as unknown as ClaimableItemParams

    await createClaimableItemUseCase(
      code,
      clientRef,
      claimCode,
      request.payload as Record<string, string>
    )

    return h
      .redirect(
        `/grant-ops/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
      )
      .code(303)
  }
}
