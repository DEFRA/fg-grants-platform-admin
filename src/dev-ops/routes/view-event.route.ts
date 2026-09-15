import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import type { EventPageQuery } from '../view-models/event-page.view-model.ts'
import {
  toEventPage,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'

/** Long enough for any label the backend spells, short enough to be one. */
const statusLabelMax = 64

/** Longer than any query this page builds for itself, and still bounded. */
const fromMax = 2048

export const viewEventRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      // `from` is checked by the view model: a bad one falls back to the plain list, not an error page.
      query: Joi.object({
        // Bounded because it is echoed into every link on the page.
        from: Joi.string().allow('').max(fromMax),
        confirm: Joi.string(),
        redriven: Joi.string(),
        // Bounded so a crafted link cannot put a sentence inside the page's own warning.
        redrive_conflict: Joi.string().allow('').max(statusLabelMax),
        redrive_error: Joi.string()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const query = request.query as unknown as EventPageQuery
    const result = await getEventUseCase(key)

    if (result.outcome === 'not-found') {
      return h.view('event-not-found', {
        pageTitle: 'Event not found',
        backHref: `/dev-ops/events${toSafeFrom(query.from)}`
      })
    }

    return h.view('event', {
      pageTitle: 'Event',
      ...toEventPage(result, key, query)
    })
  }
}
