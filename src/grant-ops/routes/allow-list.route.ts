import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  getAllowListUseCase,
  type GrantAllowList
} from '../use-cases/get-allow-list.use-case.ts'
import {
  replaceAllowListUseCase,
  type AllowListGlobal
} from '../use-cases/replace-allow-list.use-case.ts'
import type {
  AllowListFieldError,
  AllowListFormSubmission
} from '../view-models/allow-list-form.view-model.ts'
import {
  toAllowListErrorSummary,
  toAllowListForm,
  validateAllowListForm
} from '../view-models/allow-list-form.view-model.ts'

interface AllowListParams {
  code: string
}

export const allowListSavedKey = 'allowListSaved'

const params = Joi.object({ code: Joi.string().required() })

const payload = Joi.object({
  sbi: Joi.string().allow('').required(),
  crn: Joi.string().allow('').required()
}).unknown(false)

const adminHrefFor = (code: string): string =>
  `/grant-ops/grants/${encodeURIComponent(code)}/admin`

const hrefFor = (code: string): string => `${adminHrefFor(code)}#who-can-apply`

const resetHrefFor = (code: string): string => `${adminHrefFor(code)}/reset`

const emptyAllowList = (grantCode: string) => ({
  grantCode,
  global: { sbi: [], crn: [] }
})

interface PageOptions {
  code: string
  allowList: GrantAllowList
  submitted: AllowListFormSubmission | undefined
  errors: AllowListFieldError[]
  errorSummary: { text: string; href?: string }[]
  saved: string | undefined
}

const page = ({
  code,
  allowList,
  submitted,
  errors,
  errorSummary,
  saved
}: PageOptions) => ({
  code,
  pageTitle: errorSummary.length ? 'Error: Who can apply' : 'Who can apply',
  formAction: adminHrefFor(code),
  form: toAllowListForm(allowList, submitted, errors),
  errorSummary,
  resetHref: resetHrefFor(code),
  saved
})

export const viewAllowListRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/admin',
  options: { validate: { params } },
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams
    const allowList = await getAllowListUseCase(code)
    const [saved] = request.yar.flash(allowListSavedKey)

    return h.view(
      'allow-list',
      page({
        code,
        allowList,
        submitted: undefined,
        errors: [],
        errorSummary: [],
        saved
      })
    )
  }
}

export const resetAllowListRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/admin/reset',
  options: { validate: { params } },
  handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams

    return h.redirect(hrefFor(code)).code(303)
  }
}

const renderInvalid = (
  h: ResponseToolkit,
  code: string,
  form: AllowListFormSubmission,
  errors: AllowListFieldError[]
) =>
  h
    .view(
      'allow-list',
      page({
        code,
        allowList: emptyAllowList(code),
        submitted: form,
        errors,
        errorSummary: toAllowListErrorSummary(errors),
        saved: undefined
      })
    )
    .code(400)

const saveRefusalSummary = [
  {
    text: 'The allow list could not be saved. Check the entries and try again.'
  }
]

const renderRefusal = (
  h: ResponseToolkit,
  code: string,
  form: AllowListFormSubmission
) =>
  h
    .view(
      'allow-list',
      page({
        code,
        allowList: emptyAllowList(code),
        submitted: form,
        errors: [],
        errorSummary: saveRefusalSummary,
        saved: undefined
      })
    )
    .code(400)

const saveValid = async (
  request: Request,
  h: ResponseToolkit,
  code: string,
  form: AllowListFormSubmission,
  global: AllowListGlobal
) => {
  const refusal = await replaceAllowListUseCase(code, global)

  if (!refusal) {
    request.yar.flash(allowListSavedKey, 'Allow list saved')
    return h.redirect(hrefFor(code)).code(303)
  }

  if (refusal.statusCode === 404) {
    throw Boom.notFound()
  }

  return renderRefusal(h, code, form)
}

export const replaceAllowListRoute: ServerRoute = {
  method: 'POST',
  path: '/grant-ops/grants/{code}/admin',
  options: { validate: { params, payload } },
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams
    const form = request.payload as AllowListFormSubmission
    const validated = validateAllowListForm(form)

    if (!validated.global) {
      return renderInvalid(h, code, form, validated.errors)
    }

    return saveValid(request, h, code, form, validated.global)
  }
}
