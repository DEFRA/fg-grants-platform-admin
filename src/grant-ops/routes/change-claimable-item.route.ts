import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'
import type { ClaimableItem } from '../use-cases/view-change-claimable-item.use-case.ts'
import { updateClaimableItemUseCase } from '../use-cases/update-claimable-item.use-case.ts'
import { viewChangeClaimableItemUseCase } from '../use-cases/view-change-claimable-item.use-case.ts'
import type { FieldError } from '../view-models/claimable-item-form.view-model.ts'
import {
  toClaimableItemForm,
  toEntitlementForm,
  toErrorSummary,
  refusedNoticeKey,
  toFinalRefusalSummary,
  toSaveRefusalSummary,
  toUpdatedNotice,
  updatedNoticeKey,
  validateClaimableItem
} from '../view-models/claimable-item-form.view-model.ts'
import { toClaimsPage } from '../view-models/claims-page.view-model.ts'

interface ChangeClaimableItemParams {
  code: string
  clientRef: string
  entitlementId: string
}

const conflict = 409

const path =
  '/grant-ops/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}/change'

const params = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  entitlementId: Joi.string().required()
})

const noClaimsPage = (code: string) =>
  Boom.notFound(`No claims page is configured for grant "${code}"`)

const claimsHrefFor = (code: string, clientRef: string) =>
  `/grant-ops/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/claims`

const redirectWithRefusal = (
  request: Request,
  h: ResponseToolkit,
  { code, clientRef }: ChangeClaimableItemParams,
  message: string
) => {
  request.yar.flash(refusedNoticeKey, toFinalRefusalSummary(message, 'changed'))

  return h.redirect(claimsHrefFor(code, clientRef)).code(303)
}

const changePage = (
  { code, clientRef }: ChangeClaimableItemParams,
  claimableItem: ClaimableItem
) => {
  const {
    banner,
    claimableEntitlement,
    entitlementTemplate: claimableTemplate,
    ...claims
  } = claimableItem

  if (!banner) {
    throw noClaimsPage(code)
  }

  return {
    pageTitle: 'Change claimable item',
    claimableTemplate,
    formFields: toClaimableItemForm(
      claimableTemplate,
      toEntitlementForm(claimableEntitlement)
    ),
    changingEntitlementId: claimableEntitlement.entitlementId,
    ...toClaimsPage(code, clientRef, { ...claims, banner })
  }
}

const failedChangePage = (
  page: ReturnType<typeof changePage>,
  form: Record<string, string>,
  errors: FieldError[] = []
) => ({
  ...page,
  pageTitle: 'Error: Change claimable item',
  formFields: toClaimableItemForm(page.claimableTemplate, form, errors)
})

const applyUpdate = async (
  request: Request,
  h: ResponseToolkit,
  page: ReturnType<typeof changePage>,
  form: Record<string, string>
) => {
  const routeParams = request.params as unknown as ChangeClaimableItemParams
  const { code, clientRef, entitlementId } = routeParams

  const refusal = await updateClaimableItemUseCase(
    code,
    clientRef,
    entitlementId,
    page.claimableTemplate,
    form
  )

  if (refusal?.statusCode === conflict) {
    return redirectWithRefusal(request, h, routeParams, refusal.message)
  }

  if (refusal) {
    return h
      .view('update-claimable-item', {
        ...failedChangePage(page, form),
        errorSummary: toSaveRefusalSummary(refusal, 'changed')
      })
      .code(refusal.statusCode)
  }

  request.yar.flash(
    updatedNoticeKey,
    toUpdatedNotice(page.claimableTemplate, form)
  )

  return h.redirect(claimsHrefFor(code, clientRef)).code(303)
}

export const changeClaimableItemRoute: ServerRoute = {
  method: 'GET',
  path,
  options: {
    validate: { params }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const routeParams = request.params as unknown as ChangeClaimableItemParams
    const { code, clientRef, entitlementId } = routeParams

    const changeView = await viewChangeClaimableItemUseCase(
      code,
      clientRef,
      entitlementId
    )

    if (changeView.kind === 'refusal') {
      return redirectWithRefusal(request, h, routeParams, changeView.message)
    }

    return h.view(
      'update-claimable-item',
      changePage(routeParams, changeView.claimableItem)
    )
  }
}

export const updateClaimableItemRoute: ServerRoute = {
  method: 'POST',
  path,
  options: {
    validate: {
      params,
      payload: Joi.object().pattern(Joi.string(), Joi.string().allow(''))
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const routeParams = request.params as unknown as ChangeClaimableItemParams
    const { code, clientRef, entitlementId } = routeParams
    const form = request.payload as Record<string, string>

    const changeView = await viewChangeClaimableItemUseCase(
      code,
      clientRef,
      entitlementId
    )

    if (changeView.kind === 'refusal') {
      return redirectWithRefusal(request, h, routeParams, changeView.message)
    }

    const page = changePage(routeParams, changeView.claimableItem)
    const errors = validateClaimableItem(page.claimableTemplate, form)

    if (errors.length) {
      return h
        .view('update-claimable-item', {
          ...failedChangePage(page, form, errors),
          errorSummary: toErrorSummary(errors)
        })
        .code(400)
    }

    return applyUpdate(request, h, page, form)
  }
}
