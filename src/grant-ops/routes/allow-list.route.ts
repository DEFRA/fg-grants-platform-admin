import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  getAllowListUseCase,
  type GrantAllowList
} from '../use-cases/get-allow-list.use-case.ts'
import type { GasRefusal } from '../use-cases/gas-refusal.ts'
import { isAllowListValidationFailure } from '../use-cases/gas-refusal.ts'
import { replaceAllowListUseCase } from '../use-cases/replace-allow-list.use-case.ts'
import type {
  AllowListFieldError,
  AllowListFormSubmission,
  ParsedAllowListForm
} from '../view-models/allow-list-form.view-model.ts'
import {
  parseAllowListForm,
  toAllowListErrorSummary,
  toAllowListFieldErrors,
  toAllowListForm
} from '../view-models/allow-list-form.view-model.ts'

interface AllowListParams {
  code: string
}

export const allowListSavedKey = 'allowListSaved'
const allowListActiveTabKey = 'allowListActiveTab'

const params = Joi.object({ code: Joi.string().required() })

const payload = Joi.object({
  sbi: Joi.string().allow('').required(),
  crn: Joi.string().allow('').required()
}).unknown(false)

const adminHrefFor = (code: string): string =>
  `/grant-ops/grants/${encodeURIComponent(code)}/admin`

const resetHrefFor = (code: string): string => `${adminHrefFor(code)}/reset`

const emptyAllowList = (grantCode: string) => ({
  grantCode,
  global: { sbi: [], crn: [] }
})

interface PageOptions {
  activeTab: 'grant-setup' | 'who-can-apply'
  code: string
  allowList: Pick<GrantAllowList, 'grantCode' | 'global'>
  submitted: AllowListFormSubmission | undefined
  errors: AllowListFieldError[]
  errorSummary: { text: string; href?: string }[]
  saved: string | undefined
}

const page = ({
  activeTab,
  code,
  allowList,
  submitted,
  errors,
  errorSummary,
  saved
}: PageOptions) => ({
  activeTab,
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
    const [activeTab] = request.yar.flash(allowListActiveTabKey)

    return h.view(
      'allow-list',
      page({
        activeTab: activeTab === 'who-can-apply' ? activeTab : 'grant-setup',
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
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams

    // Permission is enforced by the view this redirects to, which makes its
    // own real GAS call. Checking here too would be a second audited read of
    // the whole list for a request that never shows or uses that data.
    request.yar.flash(allowListActiveTabKey, 'who-can-apply')
    return h.redirect(adminHrefFor(code)).code(303)
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
        activeTab: 'who-can-apply',
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
        activeTab: 'who-can-apply',
        code,
        allowList: emptyAllowList(code),
        submitted: form,
        errors: [],
        errorSummary: saveRefusalSummary,
        saved: undefined
      })
    )
    .code(400)

const respondToRefusal = (
  h: ResponseToolkit,
  code: string,
  form: AllowListFormSubmission,
  parsed: ParsedAllowListForm,
  refusal: GasRefusal
) => {
  if (refusal.statusCode === 404) {
    throw Boom.notFound()
  }

  if (refusal.statusCode === 403) {
    throw Boom.forbidden(
      'You do not have access to administration for this grant'
    )
  }

  if (isAllowListValidationFailure(refusal)) {
    return renderInvalid(
      h,
      code,
      form,
      toAllowListFieldErrors(parsed, refusal.details)
    )
  }

  return renderRefusal(h, code, form)
}

const saveValid = async (
  request: Request,
  h: ResponseToolkit,
  code: string,
  form: AllowListFormSubmission,
  parsed: ParsedAllowListForm
) => {
  const refusal = await replaceAllowListUseCase(code, parsed.global)

  if (!refusal) {
    request.yar.flash(allowListSavedKey, 'Allow list saved')
    request.yar.flash(allowListActiveTabKey, 'who-can-apply')
    return h.redirect(adminHrefFor(code)).code(303)
  }

  return respondToRefusal(h, code, form, parsed, refusal)
}

export const replaceAllowListRoute: ServerRoute = {
  method: 'POST',
  path: '/grant-ops/grants/{code}/admin',
  options: { validate: { params, payload } },
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams
    // Permission is enforced by the real write below, not by a discarded
    // read here: GAS enforces access on every call, so a local pre-check
    // would only duplicate a decision GAS already makes for real.
    const form = request.payload as AllowListFormSubmission
    const parsed = parseAllowListForm(form)

    return saveValid(request, h, code, form, parsed)
  }
}
