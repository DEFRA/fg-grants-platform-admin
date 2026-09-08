import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import { createClaimableItemUseCase } from '../use-cases/create-claimable-item.use-case.ts'
import { viewNewClaimableItemUseCase } from '../use-cases/view-new-claimable-item.use-case.ts'
import { getClaimsUseCase } from '../use-cases/get-claims.use-case.ts'
import type { FieldError } from '../view-models/claimable-item-form.view-model.ts'
import {
  createdNoticeKey,
  toClaimableItemForm,
  toCreatedNotice,
  toErrorSummary,
  toRefusalSummary,
  validateClaimableItem
} from '../view-models/claimable-item-form.view-model.ts'
import { toClaimsPage } from '../view-models/claims-page.view-model.ts'
import Joi from 'joi'

interface ClaimableItemParams {
  code: string
  clientRef: string
  claimCode: string
}

interface GasError {
  output?: { statusCode?: number; payload?: { message?: string } }
  data?: { payload?: { message?: string } }
}

const statusOf = (error: unknown) =>
  (error as GasError | undefined)?.output?.statusCode

const dataPayloadOf = (error: unknown) =>
  (error as GasError | undefined)?.data?.payload ?? {}

const outputPayloadOf = (error: unknown) =>
  (error as GasError | undefined)?.output?.payload ?? {}

const messageOf = (error: unknown) =>
  dataPayloadOf(error).message ??
  outputPayloadOf(error).message ??
  'The backend refused the request.'

const params = Joi.object({
  code: Joi.string().required(),
  clientRef: Joi.string().required(),
  claimCode: Joi.string().required()
})

const resolvePage = async ({
  code,
  clientRef,
  claimCode
}: ClaimableItemParams) => {
  const { banner, claimableTemplate, ...claims } =
    await viewNewClaimableItemUseCase(code, clientRef, claimCode)

  if (!banner) {
    throw Boom.notFound(`No claims page is configured for grant "${code}"`)
  }

  return {
    claimableTemplate,
    page: {
      claimableTemplate,
      ...toClaimsPage(code, clientRef, { ...claims, banner })
    }
  }
}

type ResolvedPage = Awaited<ReturnType<typeof resolvePage>>

type PostPage =
  | { kind: 'page'; resolvedPage: ResolvedPage }
  | { kind: 'refusal'; message: string }

const resolvePostPage = async (
  params: ClaimableItemParams
): Promise<PostPage> => {
  try {
    return { kind: 'page', resolvedPage: await resolvePage(params) }
  } catch (error) {
    return statusOf(error) === 409
      ? { kind: 'refusal', message: messageOf(error) }
      : Promise.reject(error)
  }
}

const referenceRefusalPage = async (
  code: string,
  clientRef: string,
  message: string
) => {
  const { banner, ...claims } = await getClaimsUseCase(code, clientRef)

  if (!banner) {
    throw Boom.notFound(`No claims page is configured for grant "${code}"`)
  }

  return {
    pageTitle: 'Error: Claims',
    errorSummary: toRefusalSummary(message),
    ...toClaimsPage(code, clientRef, { ...claims, banner })
  }
}

export const newClaimableItemRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/applications/{clientRef}/claims/new-entitlement/{claimCode}',
  options: {
    validate: { params }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { claimableTemplate, page } = await resolvePage(
      request.params as unknown as ClaimableItemParams
    )

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

    const form = request.payload as Record<string, string>

    const postPage = await resolvePostPage({ code, clientRef, claimCode })

    if (postPage.kind === 'refusal') {
      return h
        .view(
          'claims',
          await referenceRefusalPage(code, clientRef, postPage.message)
        )
        .code(409)
    }

    const { claimableTemplate, page } = postPage.resolvedPage

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
          errorSummary: toRefusalSummary(refusal.message),
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
