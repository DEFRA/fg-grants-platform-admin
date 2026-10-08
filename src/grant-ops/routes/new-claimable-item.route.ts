import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import { resolveClaimsAccess } from '../view-models/claims-access.ts'
import { createClaimableItemUseCase } from '../use-cases/create-claimable-item.use-case.ts'
import { viewNewClaimableItemUseCase } from '../use-cases/view-new-claimable-item.use-case.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'
import type { FieldError } from '../view-models/claimable-item-form.view-model.ts'
import {
  createdNoticeKey,
  toClaimableItemForm,
  toCreatedNotice,
  toErrorSummary,
  toFinalRefusalSummary,
  toSaveRefusalSummary,
  validateClaimableItem
} from '../view-models/claimable-item-form.view-model.ts'
import {
  toClaimsPage,
  toClaimsRefusalPage
} from '../view-models/claims-page.view-model.ts'
import Joi from 'joi'

interface ClaimableItemParams {
  code: string
  clientRef: string
  claimCode: string
}

const params = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  claimCode: Joi.string().required()
})

const noClaimsPage = (code: string) =>
  Boom.notFound(`No claims page is configured for grant "${code}"`)

const cwRolesOf = (request: Request): string[] | null | undefined =>
  (request.auth.credentials.user as { cwRoles?: string[] | null })?.cwRoles

const assertFullClaimsAccess = async (
  request: Request,
  code: string,
  clientRef: string
) => {
  if (cwRolesOf(request) === null) {
    throw Boom.serverUnavailable(
      'Caseworking roles could not be determined — try signing out and back in'
    )
  }

  const overview = await getClaimsUseCase(code, clientRef)
  const access = resolveClaimsAccess(
    cwRolesOf(request),
    overview.claimsRequiredRoles
  )

  if (access !== 'full') {
    throw Boom.forbidden(
      'You do not have the required roles to create claimable items'
    )
  }
}

const resolvePage = async ({
  code,
  clientRef,
  claimCode
}: ClaimableItemParams) => {
  const newItem = await viewNewClaimableItemUseCase(code, clientRef, claimCode)

  if (newItem.kind === 'refusal') {
    return newItem
  }

  const { banner, claimableTemplate, ...claims } = newItem.claimableItem

  if (!banner) {
    throw noClaimsPage(code)
  }

  return {
    kind: 'page' as const,
    claimableTemplate,
    page: {
      claimableTemplate,
      ...toClaimsPage(code, clientRef, { ...claims, banner })
    }
  }
}

const viewRefusal = async (
  h: ResponseToolkit,
  { code, clientRef }: ClaimableItemParams,
  message: string
) => {
  const { banner, ...claims } = await getClaimsUseCase(code, clientRef)

  if (!banner) {
    throw noClaimsPage(code)
  }

  return h
    .view(
      'claims',
      toClaimsRefusalPage(
        code,
        clientRef,
        { ...claims, banner },
        toFinalRefusalSummary(message)
      )
    )
    .code(409)
}

export const newClaimableItemRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims/new-entitlement/{claimCode}',
  options: {
    validate: { params }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const routeParams = request.params as unknown as ClaimableItemParams
    await assertFullClaimsAccess(
      request,
      routeParams.code,
      routeParams.clientRef
    )

    const resolved = await resolvePage(routeParams)

    if (resolved.kind === 'refusal') {
      return viewRefusal(h, routeParams, resolved.message)
    }

    const { claimableTemplate, page } = resolved

    return h.view('new-claimable-item', {
      pageTitle: 'Add claimable item',
      formFields: toClaimableItemForm(claimableTemplate),
      ...page
    })
  }
}

export const createClaimableItemRoute: ServerRoute = {
  method: 'POST',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims/new-entitlement/{claimCode}',
  options: {
    validate: {
      params,
      payload: Joi.object().pattern(Joi.string(), Joi.string().allow(''))
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code, clientRef, claimCode } =
      request.params as unknown as ClaimableItemParams
    await assertFullClaimsAccess(request, code, clientRef)

    const form = request.payload as Record<string, string>

    const resolved = await resolvePage({ code, clientRef, claimCode })

    if (resolved.kind === 'refusal') {
      return viewRefusal(h, { code, clientRef, claimCode }, resolved.message)
    }

    const { claimableTemplate, page } = resolved

    const errors: FieldError[] = validateClaimableItem(claimableTemplate, form)

    if (errors.length) {
      return h
        .view('new-claimable-item', {
          pageTitle: 'Error: Add claimable item',
          errorSummary: toErrorSummary(errors),
          formFields: toClaimableItemForm(claimableTemplate, form, errors),
          ...page
        })
        .code(400)
    }

    const refusal = await createClaimableItemUseCase(
      code,
      clientRef,
      claimableTemplate,
      form
    )

    if (refusal) {
      return h
        .view('new-claimable-item', {
          pageTitle: 'Error: Add claimable item',
          errorSummary: toSaveRefusalSummary(refusal),
          formFields: toClaimableItemForm(claimableTemplate, form),
          ...page
        })
        .code(refusal.statusCode)
    }

    request.yar.flash(
      createdNoticeKey,
      toCreatedNotice(claimableTemplate, form)
    )

    return h
      .redirect(
        `/grant-ops/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`
      )
      .code(303)
  }
}
