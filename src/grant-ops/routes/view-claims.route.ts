import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { resolveClaimsAccess } from '../view-models/claims-access.ts'
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

const cwRolesOf = (request: Request): string[] | null | undefined =>
  (request.auth.credentials.user as { cwRoles?: string[] | null })?.cwRoles

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

    const { banner, claimsRequiredRoles, ...claims } = await getClaimsUseCase(
      code,
      clientRef
    )

    if (!banner) {
      throw Boom.notFound(`No claims page is configured for grant "${code}"`)
    }

    if (cwRolesOf(request) === null && claimsRequiredRoles) {
      throw Boom.serverUnavailable(
        'Caseworking roles could not be determined — try signing out and back in'
      )
    }

    const access = resolveClaimsAccess(cwRolesOf(request), claimsRequiredRoles)

    if (access === 'hidden') {
      throw Boom.forbidden(
        'You do not have the required roles to view claims for this grant'
      )
    }

    const [createdNotice] = request.yar.flash(createdNoticeKey)
    const [updatedNotice] = request.yar.flash(updatedNoticeKey)
    const refusals = request.yar.flash(refusedNoticeKey)

    return h.view('claims', {
      ...toClaimsPageTitle(refusals),
      createdNotice,
      updatedNotice,
      ...toClaimsPage(code, clientRef, { ...claims, banner }, access)
    })
  }
}
