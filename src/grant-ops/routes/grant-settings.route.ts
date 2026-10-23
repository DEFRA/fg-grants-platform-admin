import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import {
  isCaseworkingRolesUnavailable,
  toGasRefusal
} from '../use-cases/gas-refusal.ts'
import { getAllowListUseCase } from '../use-cases/get-allow-list.use-case.ts'
import { saveGrantSettingsUseCase } from '../use-cases/grant-settings.use-case.ts'
import {
  allowListActiveTabKey,
  allowListSavedKey,
  toAdminHref,
  toAllowListPage
} from '../view-models/allow-list-page.view-model.ts'

const renderSetupError = async (
  h: ResponseToolkit,
  code: string,
  status: unknown,
  message: string
) => {
  const view = await getAllowListUseCase(code)
  return h
    .view('allow-list', {
      ...toAllowListPage(code, view, {
        saved: undefined,
        activeTab: 'grant-setup'
      }),
      pageTitle: 'Error: Grant setup',
      settings: {
        open: status === 'open' ? true : status === 'closed' ? false : undefined
      },
      settingsFormAction: `${toAdminHref(code)}/settings`,
      settingsError: message,
      errorSummary: [{ text: message, href: '#grant-status' }]
    })
    .code(400)
}

const respondToSaveFailure = (
  h: ResponseToolkit,
  code: string,
  status: unknown,
  error: unknown
) => {
  if (toGasRefusal(error)?.statusCode === 400) {
    return renderSetupError(
      h,
      code,
      status,
      'Grant setup could not be saved. Try again.'
    )
  }
  if (isCaseworkingRolesUnavailable(error)) {
    return h
      .view('roles-unavailable', {
        pageTitle: 'Caseworking roles could not be determined',
        heading: 503,
        message: 'Caseworking roles could not be determined — try again later'
      })
      .code(503)
  }
  throw error
}

export const saveGrantSettingsRoute: ServerRoute = {
  method: 'POST',
  path: '/grant-ops/grants/{code}/admin/settings',
  options: {
    validate: {
      params: Joi.object({ code: Joi.string().required() }),
      payload: Joi.object({ status: Joi.any() }).unknown(false)
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { code } = request.params
    const { status } = request.payload as { status?: unknown }
    try {
      if (status !== 'open' && status !== 'closed') {
        return await renderSetupError(
          h,
          code,
          status,
          'Select whether the grant is open or closed'
        )
      }
      await saveGrantSettingsUseCase(code, status === 'open')
      request.yar.flash(allowListSavedKey, 'Grant setup saved')
      request.yar.flash(allowListActiveTabKey, 'grant-setup')
      return h.redirect(toAdminHref(code)).code(303)
    } catch (error) {
      return respondToSaveFailure(h, code, status, error)
    }
  }
}
