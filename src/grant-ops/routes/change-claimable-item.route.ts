import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'
import type { ClaimableItem } from '../use-cases/view-change-claimable-item.use-case.ts'
import type { GasRefusal } from '../use-cases/gas-refusal.ts'
import { conflict, isConfigurationChange } from '../use-cases/gas-refusal.ts'
import { updateClaimableItemUseCase } from '../use-cases/update-claimable-item.use-case.ts'
import { viewChangeClaimableItemUseCase } from '../use-cases/view-change-claimable-item.use-case.ts'
import { resolveClaimsAccess } from '../view-models/claims-access.ts'
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

const path =
  '/grant-ops/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}/change'

const params = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  entitlementId: Joi.string().required()
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
  const overview = await getClaimsUseCase(code, clientRef)
  const access = resolveClaimsAccess(
    cwRolesOf(request),
    overview.claimsRequiredRoles
  )

  if (cwRolesOf(request) === null && overview.claimsRequiredRoles) {
    throw Boom.serverUnavailable(
      'Caseworking roles could not be determined — try signing out and back in'
    )
  }

  if (access !== 'full') {
    throw Boom.forbidden(
      'You do not have the required roles to change claimable items'
    )
  }
}

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

const viewRefusedForm = (
  h: ResponseToolkit,
  page: ReturnType<typeof changePage>,
  form: Record<string, string>,
  refusal: GasRefusal
) =>
  h
    .view('update-claimable-item', {
      ...failedChangePage(page, form),
      errorSummary: toSaveRefusalSummary(refusal, 'changed')
    })
    .code(refusal.statusCode)

const retryOnRefreshedForm = async (
  request: Request,
  h: ResponseToolkit,
  form: Record<string, string>,
  refusal: GasRefusal
) => {
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

  return viewRefusedForm(
    h,
    changePage(routeParams, changeView.claimableItem),
    form,
    refusal
  )
}

const respondToRefusal = (
  request: Request,
  h: ResponseToolkit,
  page: ReturnType<typeof changePage>,
  form: Record<string, string>,
  refusal: GasRefusal
) => {
  if (isConfigurationChange(refusal)) {
    return retryOnRefreshedForm(request, h, form, refusal)
  }

  if (refusal.statusCode === conflict) {
    return redirectWithRefusal(
      request,
      h,
      request.params as unknown as ChangeClaimableItemParams,
      refusal.message
    )
  }

  return viewRefusedForm(h, page, form, refusal)
}

const applyUpdate = async (
  request: Request,
  h: ResponseToolkit,
  page: ReturnType<typeof changePage>,
  form: Record<string, string>
) => {
  const { code, clientRef, entitlementId } =
    request.params as unknown as ChangeClaimableItemParams

  const refusal = await updateClaimableItemUseCase(
    code,
    clientRef,
    entitlementId,
    page.claimableTemplate,
    form
  )

  if (refusal) {
    return respondToRefusal(request, h, page, form, refusal)
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
    await assertFullClaimsAccess(request, code, clientRef)

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
    await assertFullClaimsAccess(request, code, clientRef)

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
