import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { config } from '../../common/config.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  eventPageCache,
  eventTabMax,
  isProduction,
  toEventResult
} from '../view-models/event-page.view-model.ts'
import { noAnswerCode } from '../view-models/event-watch.ts'
import { backSchema } from '../view-models/record-filters.ts'
import { shellQuery, timesOf } from '../view-models/times.ts'

/**
 * A settled redrive's result, as a part of the page that was checking for
 * it: one read of the event, like a page view, and nothing taken from the
 * session, so a write's message or a held save is still there for the page.
 */
export const eventResultRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}/result',
  options: {
    cache: eventPageCache,
    validate: {
      params: Joi.object(eventAddress),
      query: Joi.object({
        back: backSchema,
        tab: Joi.string().allow('').max(eventTabMax),
        ...shellQuery
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = toEventKey(request.params)
    const result = await getEventUseCase(key)
    const page = toEventResult({
      result,
      key,
      times: timesOf(request),
      catalogue: shellCatalogue(request),
      prod: isProduction(config.get('environmentLabel')),
      query: request.query as EventPageQuery
    })

    if (page === null) {
      return h.response().code(noAnswerCode)
    }

    request.app.part = true

    return h.view('events/result', page)
  }
}
