import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  createdNoticeKey,
  refusedNoticeKey,
  updatedNoticeKey
} from '../view-models/claimable-item-form.view-model.ts'
import {
  toClaimsPage,
  toClaimsPageTitle
} from '../view-models/claims-page.view-model.ts'
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

    const [createdNotice] = request.yar.flash(createdNoticeKey)
    const [updatedNotice] = request.yar.flash(updatedNoticeKey)
    const refusals = request.yar.flash(refusedNoticeKey)

    return h.view('claims', {
      ...toClaimsPageTitle(refusals),
      createdNotice,
      updatedNotice,
      ...toClaimsPage(code, clientRef, { ...claims, banner })
    })
  }
}
