import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import { getEventCountsUseCase } from '../use-cases/get-events.use-case.ts'
import { redriveQueryUseCase } from '../use-cases/redrive-query.use-case.ts'
import type { RedriveQueryFilters } from '../view-models/redrive-query.view-model.ts'
import {
  toRedriveQueryConfirm,
  toRedriveQueryResults
} from '../view-models/redrive-query.view-model.ts'
import { toActor } from '../view-models/actor.ts'

/**
 * How many events one run may process, and the backend's own default.
 *
 * Not a technical limit either — the endpoint would page further — but the
 * limit of what should happen to a live queue on one click. Seven thousand
 * messages put back at once is not a recovery, it is the same incident again;
 * five hundred is a run an operator can watch, judge and repeat.
 */
const runLimit = 500

/**
 * The filters both halves of this flow carry, unconstrained beyond being
 * strings, exactly as the list's own query is: fg-gas-backend owns the enums
 * and answers 400 for a value it does not accept.
 */
const filters = {
  status: Joi.string().allow(''),
  service: Joi.string().allow(''),
  q: Joi.string().allow(''),
  error: Joi.string().allow(''),
  from: Joi.string().allow(''),
  to: Joi.string().allow('')
}

/** A parameter that has something in it, or nothing at all. */
const toFilters = (source: RedriveQueryFilters): RedriveQueryFilters =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => Boolean(value))
  )

/**
 * Stage one of the bulk redrive by query: what is about to happen, and to how
 * many.
 *
 * A GET, unlike the ticked-boxes flow's first stage, because there is nothing
 * private in it: the whole selection *is* the url the operator was already on.
 * That makes the confirmation shareable — "are you happy for me to run this?"
 * is a real question an operator asks a colleague before redriving seven
 * thousand messages — and it makes the count on it a fresh read rather than a
 * number handed over on a link.
 *
 * The count is read here rather than trusted from the page that linked in.
 * `Redrive all 7,064 matching` is a promise about a set, and the page that
 * makes it has to be the page that counted it — a figure passed on a query
 * string is a figure anybody can edit.
 *
 * No `options.auth` here on purpose: src/dev-ops/index.ts registers this route
 * through `scopedTo('FCP.GrantOperationsAdmin', …)`, and that helper only
 * applies the scope to a route that declares none of its own.
 */
export const redriveQueryConfirmRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events/redrive-query-confirm',
  options: {
    validate: { query: Joi.object(filters) }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = toFilters(request.query as unknown as RedriveQueryFilters)
    const { service, q, error, from, to } = query
    const facets = await getEventCountsUseCase({ service, q, error, from, to })

    return h.view('events-redrive-query-confirm', {
      pageTitle: 'Redrive all matching events',
      ...toRedriveQueryConfirm(
        { ...query, status: 'DEAD_LETTER' },
        facets === null ? null : facets.counts.DEAD_LETTER,
        runLimit
      )
    })
  }
}

/**
 * Stage two: the write itself, and the five figures it came to.
 *
 * A POST, reached only from the confirmation, because it queues messages — and
 * it renders its result rather than redirecting, which the single-event redrive
 * deliberately does not do. The difference is what a reload would repeat: there
 * the redirect exists so a refresh cannot re-queue one message, and here a
 * refresh re-submitting the form is a browser warning the operator has to
 * confirm, while the alternative — carrying five figures and a per-source table
 * through a redirect — would put the whole result in a url.
 *
 * `status` is deliberately not forwarded: the endpoint redrives dead letters
 * and nothing else, so a status parameter on the write would be an invented one.
 * It is kept for the links back, which are about the list.
 */
export const redriveQueryRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/redrive-query',
  options: {
    validate: {
      payload: Joi.object(filters).default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = toFilters(request.payload as RedriveQueryFilters)
    const { service, q, error, from, to } = query
    const { result } = await redriveQueryUseCase(
      { service, q, error, from, to, limit: String(runLimit) },
      toActor(request)
    )

    return h.view('events-redrive-query-results', {
      pageTitle: 'Redrive results',
      ...toRedriveQueryResults(result, { ...query, status: 'DEAD_LETTER' })
    })
  }
}
