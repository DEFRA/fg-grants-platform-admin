import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getEventStatusUseCase } from '../use-cases/get-event-status.use-case.ts'
import { eventAddress, toEventKey } from '../view-models/event-address.ts'
import { eventPageCache } from '../view-models/event-page.view-model.ts'
import { noAnswerCode } from '../view-models/event-watch.ts'

/** What the page a redrive returned asks every few seconds: whether it has settled. A check that fails is a 502 the page ignores. */
export const eventStatusRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/{service}/{box}/{id}/status',
  options: {
    cache: eventPageCache,
    validate: { params: Joi.object(eventAddress) }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const check = await getEventStatusUseCase(toEventKey(request.params))

    return check === null ? h.response().code(noAnswerCode) : check
  }
}
