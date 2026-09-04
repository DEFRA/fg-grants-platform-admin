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

export const viewEventRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      /**
       * Five parameters, none of them constrained beyond being a string.
       *
       * `from` is the list's own query string, handed back opaquely — it is
       * checked by the view model rather than by Joi, because a `from` that
       * fails the check is not worth an error page: the operator followed a
       * link they did not write, and the plain list is a perfectly good
       * answer. The three redrive parameters are written by this app's own
       * redirect, and each of them only ever chooses a sentence.
       */
      query: Joi.object({
        from: Joi.string().allow(''),
        confirm: Joi.string(),
        redriven: Joi.string(),
        redrive_conflict: Joi.string().allow(''),
        redrive_error: Joi.string()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const query = request.query as unknown as EventPageQuery
    const result = await getEventUseCase(key)

    // A 404 is a page, not an error: the link was stale, and the only thing
    // worth saying is that and the way back to the list they came from.
    if (result.outcome === 'not-found') {
      return h.view('event-not-found', {
        pageTitle: 'Event not found',
        backHref: `/dev-ops/events${toSafeFrom(query.from)}`
      })
    }

    return h.view('event', {
      // The type titles the tab, so an operator with four of these open can
      // tell them apart without reading four identical `Event` labels.
      pageTitle: result.event?.type ?? 'Event',
      ...toEventPage(result, key, query, new Date())
    })
  }
}
