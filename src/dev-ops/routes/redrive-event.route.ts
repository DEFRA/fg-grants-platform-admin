import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import type { RedriveResult } from '../use-cases/redrive-event.use-case.ts'
import { redriveEventUseCase } from '../use-cases/redrive-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { toActor } from '../view-models/actor.ts'

/**
 * See other: the browser follows a write with a GET, so a reload of the page
 * that lands never re-submits the redrive. Spelled out here because a route
 * may not reach into common/status-codes.ts.
 */
const seeOther = 303

/**
 * What the redirect after the write has to carry, one parameter per outcome.
 *
 * The result cannot be rendered here: a page rendered in the response to a
 * POST is a page whose reload re-submits it, and this one writes to a queue.
 * So the outcome travels in the url of the GET that follows, and the inspect
 * page — a fresh read, which knows nothing about the click — says it.
 *
 * A conflict carries the status GAS reported, because "it did not work" is a
 * useless sentence next to "it is Resubmitted already".
 */
const outcomeParams: Record<
  string,
  (result: RedriveResult) => [string, string]
> = {
  redriven: () => ['redriven', '1'],
  conflict: (result) => ['redrive_conflict', result.status ?? ''],
  'not-found': () => ['redrive_error', 'missing'],
  unavailable: () => ['redrive_error', 'failed']
}

const toRedirect = (
  key: EventKey,
  from: string,
  result: RedriveResult
): string => {
  const params = new URLSearchParams()

  if (from !== '') {
    params.set('from', from)
  }

  const [name, value] = outcomeParams[result.outcome](result)

  params.set(name, value)

  return `/dev-ops/events/${key.service}/${key.box}/${key.id}?${params}`
}

/**
 * The one write this app makes.
 *
 * No CSRF token, deliberately and not by omission: this app has no crumb
 * machinery of any kind, the route sits behind the session strategy and the
 * `FCP.GrantOperationsAdmin` scope like every other dev-ops route, and the
 * worst a forged request could do is re-queue a message that was already
 * meant to be re-queued. Adding a token here would be adding it in one place
 * out of one, which is the shape of a defence that quietly stops working.
 *
 * No `options.auth` for the same reason as its neighbours: src/dev-ops/index.ts
 * registers this through `scopedTo`, and that helper only scopes a route that
 * declares no auth of its own.
 */
export const redriveEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/redrive',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      // The form carries one field, and only so the page it returns to is the
      // page the operator started from. An absent or hostile value is dropped
      // by `toSafeFrom`, exactly as it is on the inspect page itself.
      payload: Joi.object({
        from: Joi.string().allow('').default('')
      }).default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { from } = request.payload as { from?: string }
    const result = await redriveEventUseCase(key, toActor(request))

    return h.redirect(toRedirect(key, toSafeFrom(from), result)).code(seeOther)
  }
}
