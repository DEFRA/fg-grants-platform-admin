import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { toClaimsPage } from '../view-models/claims-page.view-model.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'

interface ClaimsParams {
  code: string
  clientRef: string
}

export const viewClaimsRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims',
  options: {
    validate: {
      params: Joi.object({
        code: Joi.string().required(),
        clientRef: Joi.string().required()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, clientRef } = request.params as unknown as ClaimsParams

    const { banner, ...claims } = await getClaimsUseCase(code, clientRef)

    // backend answers 404 for grant with no page configuration, and this guards the case of an older backend
    // that has no page config
    if (!banner) {
      throw Boom.notFound(`No claims page is configured for grant "${code}"`)
    }

    return h.view('claims', {
      pageTitle: 'Claims',
      ...toClaimsPage(code, clientRef, { ...claims, banner })
    })
  }
}
