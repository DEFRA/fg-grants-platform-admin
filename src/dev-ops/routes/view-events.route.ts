import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'

/**
 * Every parameter is optional and unconstrained beyond being a string. No
 * filter is All, which is the page an operator opens by default.
 *
 * The enums are deliberately not repeated here. fg-gas-backend owns them and
 * answers 400 for a value it does not accept — including a tampered cursor —
 * and this app turns that into the page's own error alert. Validating the
 * values here would instead replace the whole screen with the shared govuk
 * error page (src/server/plugins/errors.ts), which is a worse answer for an
 * operator who reached this page because something is already wrong. Unknown
 * *keys* are still rejected by Joi's default, which catches a typo'd link.
 *
 * No `options.auth` here on purpose: src/dev-ops/index.ts registers this route
 * through `scopedTo('FCP.GrantOperationsAdmin', …)`, and that helper only
 * applies the scope to a route that declares none of its own. Adding an `auth`
 * key below would silently unscope the page.
 */
export const viewEventsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events',
  options: {
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        direction: Joi.string(),
        status: Joi.string(),
        service: Joi.string()
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = request.query as unknown as EventsQuery

    return h.view('events', {
      pageTitle: 'Events',
      ...toEventsPage(await getEventsUseCase(query), query)
    })
  }
}
