import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  isCaseworkingRolesUnavailable,
  toGasRefusal
} from '../use-cases/gas-refusal.ts'
import type { AllowListView } from '../use-cases/get-allow-list.use-case.ts'
import { getAllowListUseCase } from '../use-cases/get-allow-list.use-case.ts'
import type {
  AllowListFormSubmission,
  ReplaceAllowListOutcome
} from '../use-cases/replace-allow-list.use-case.ts'
import { replaceAllowListUseCase } from '../use-cases/replace-allow-list.use-case.ts'

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

interface ErrorSummaryItem {
  text: string
  href?: string
  attributes?: { 'data-error-line': number }
}

interface PageOptions {
  activeTab: 'grant-setup' | 'who-can-apply'
  code: string
  view: AllowListView
  errorSummary: ErrorSummaryItem[]
  saved: string | undefined
}

const page = ({ activeTab, code, view, errorSummary, saved }: PageOptions) => ({
  activeTab,
  code,
  pageTitle: errorSummary.length ? 'Error: Who can apply' : 'Who can apply',
  formAction: adminHrefFor(code),
  form: view,
  errorSummary,
  resetHref: resetHrefFor(code),
  saved
})

const activeTabFor = (activeTab: string | undefined) =>
  activeTab === 'who-can-apply' ? activeTab : 'grant-setup'

const forbidden = 403
const serviceUnavailable = 503

const viewRolesUnavailable = (h: ResponseToolkit) =>
  h
    .view('roles-unavailable', {
      pageTitle: 'Caseworking roles could not be determined',
      heading: serviceUnavailable,
      message: 'Caseworking roles could not be determined — try again later'
    })
    .code(serviceUnavailable)

const refuseAdministration = () => {
  throw Boom.forbidden(
    'You do not have access to administration for this grant'
  )
}

/** GAS refuses administration with a 403, and answers a 503 naming the roles lookup when it cannot tell. */
const respondToAdministrationFailure = (h: ResponseToolkit, error: unknown) => {
  if (isCaseworkingRolesUnavailable(error)) {
    return viewRolesUnavailable(h)
  }

  if (toGasRefusal(error)?.statusCode === forbidden) {
    return refuseAdministration()
  }

  throw error
}

export const viewAllowListRoute: ServerRoute = {
  method: 'GET',
  path: '/grant-ops/grants/{code}/admin',
  options: { validate: { params } },
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params as unknown as AllowListParams
    try {
      const view = await getAllowListUseCase(code)
      const [saved] = request.yar.flash(allowListSavedKey)
      const [activeTab] = request.yar.flash(allowListActiveTabKey)

      return h.view(
        'allow-list',
        page({
          activeTab: activeTabFor(activeTab),
          code,
          view,
          errorSummary: [],
          saved
        })
      )
    } catch (error) {
      return respondToAdministrationFailure(h, error)
    }
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

const saveRefusalSummary = [
  {
    text: 'The allow list could not be saved. Check the entries and try again.'
  }
]

/**
 * There is no view-model left in GPA to rebuild field values from what the
 * user typed, so this doesn't try: it re-fetches the current saved state and
 * shows a generic banner. GAS's only documented allow-list refusal mode is
 * the shaped 'invalid' outcome, handled separately below - this is a
 * defensive fallback for anything else (an unshaped 400, or an unexpected
 * refusal shape).
 */
const renderGenericRefusal = async (h: ResponseToolkit, code: string) => {
  const view = await getAllowListUseCase(code)

  return h
    .view(
      'allow-list',
      page({
        activeTab: 'who-can-apply',
        code,
        view,
        errorSummary: saveRefusalSummary,
        saved: undefined
      })
    )
    .code(400)
}

const respondToOutcome = (
  h: ResponseToolkit,
  code: string,
  outcome: Exclude<ReplaceAllowListOutcome, { outcome: 'saved' }>
) => {
  if (outcome.outcome === 'invalid') {
    return h
      .view(
        'allow-list',
        page({
          activeTab: 'who-can-apply',
          code,
          view: outcome.view,
          errorSummary: outcome.view.errorSummary,
          saved: undefined
        })
      )
      .code(400)
  }

  const { refusal } = outcome

  if (refusal.statusCode === 404) {
    throw Boom.notFound()
  }

  if (refusal.statusCode === forbidden) {
    return refuseAdministration()
  }

  return renderGenericRefusal(h, code)
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

    try {
      const outcome = await replaceAllowListUseCase(code, form)

      if (outcome.outcome === 'saved') {
        request.yar.flash(allowListSavedKey, 'Allow list saved')
        request.yar.flash(allowListActiveTabKey, 'who-can-apply')
        return h.redirect(adminHrefFor(code)).code(303)
      }

      return await respondToOutcome(h, code, outcome)
    } catch (error) {
      return respondToAdministrationFailure(h, error)
    }
  }
}
