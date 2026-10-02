import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type {
  ApplicationRef,
  ApplicationTab
} from '../use-cases/get-application-page.use-case.ts'
import {
  applicationTabs,
  getApplicationPageUseCase
} from '../use-cases/get-application-page.use-case.ts'
import { toApplicationPage } from '../view-models/application-page.view-model.ts'
import { applicationsPath } from '../view-models/applications-page.view-model.ts'
import { recordPageCache } from '../view-models/list-filters.ts'
import { slugFilter } from '../view-models/record-filters.ts'

export const viewApplicationRoute: ServerRoute = {
  method: 'GET',
  path: `${applicationsPath}/{code}/{clientRef}`,
  options: {
    cache: recordPageCache,
    validate: {
      params: Joi.object({
        code: slugFilter.required(),
        clientRef: slugFilter.required()
      }),
      query: Joi.object({
        section: Joi.string()
          .valid(...applicationTabs)
          .default('overview')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const ref = request.params as unknown as ApplicationRef
    const { section } = request.query as { section: ApplicationTab }
    const { outcome, page } = await getApplicationPageUseCase(ref, section)

    if (outcome === 'not-found') {
      throw Boom.notFound()
    }

    if (page === null) {
      return h.view('application', {
        pageTitle: 'Application',
        clientRef: ref.clientRef,
        backHref: applicationsPath,
        unavailable: true,
        timedOut: outcome === 'timed-out'
      })
    }

    return h.view('application', {
      pageTitle: 'Application',
      ...toApplicationPage(page, section)
    })
  }
}
