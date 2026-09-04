import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import type { ParkResult } from '../use-cases/park-event.use-case.ts'
import {
  parkEventUseCase,
  unparkEventUseCase
} from '../use-cases/park-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import { toActor } from '../view-models/actor.ts'

/**
 * See other: the browser follows a write with a GET, so a reload of the page
 * that lands never re-submits it. Spelled out here because a route may not
 * reach into common/status-codes.ts.
 */
const seeOther = 303

/**
 * How long a reason may be, matching the backend's own limit. It is a sentence
 * for the next operator, not an incident report, and a limit stated here as
 * well as in the textarea's `maxlength` is what makes the limit true for a
 * request that did not come from the textarea.
 */
const maxReasonChars = 512

/**
 * What the redirect after the write has to carry, one parameter per outcome —
 * the same four the redrive has, spelled the same way. The result cannot be
 * rendered here: a page rendered in the response to a POST is a page whose
 * reload re-submits it.
 */
const outcomeParams: Record<string, (result: ParkResult) => [string, string]> =
  {
    parked: () => ['parked', '1'],
    conflict: (result) => ['park_conflict', result.status ?? ''],
    'not-found': () => ['park_error', 'missing'],
    unavailable: () => ['park_error', 'failed']
  }

const toRedirect = (
  key: EventKey,
  from: string,
  result: ParkResult,
  success: [string, string]
): string => {
  const params = new URLSearchParams()

  if (from !== '') {
    params.set('from', from)
  }

  const [name, value] =
    result.outcome === 'parked'
      ? success
      : outcomeParams[result.outcome](result)

  params.set(name, value)

  return `/dev-ops/events/${key.service}/${key.box}/${key.id}?${params}`
}

/**
 * The two halves of one decision, in one file.
 *
 * Park and unpark are not two features that happen to be adjacent: an operator
 * only ever parks something because they can unpark it, and the second exists
 * to make the first safe. Splitting them across two files would put the
 * redirect table, the reason limit and the outcome vocabulary they share in one
 * of them and an import in the other.
 *
 * No CSRF token, for the same reason the redrive carries none: this app has no
 * crumb machinery anywhere, both routes sit behind the session strategy and the
 * `FCP.GrantOperationsAdmin` scope, and a defence added in one place out of
 * three is a defence that quietly stops working.
 *
 * No `options.auth` for the same reason as their neighbours: src/dev-ops/index.ts
 * registers these through `scopedTo`, and that helper only scopes a route that
 * declares no auth of its own.
 */
export const parkEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/park',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      /**
       * The reason is required here as well as in the form, and it is the one
       * field on any write this app makes that is validated for its content
       * rather than its shape. A park with no reason is an event that has
       * silently left the dead-letter count — which is worse than an event
       * nobody parked, because the next operator has no way of knowing why it
       * is not on their list.
       */
      payload: Joi.object({
        reason: Joi.string().trim().min(1).max(maxReasonChars).required(),
        from: Joi.string().allow('').default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { reason, from } = request.payload as {
      reason: string
      from?: string
    }
    const result = await parkEventUseCase(key, reason, toActor(request))

    return h
      .redirect(toRedirect(key, toSafeFrom(from), result, ['parked', '1']))
      .code(seeOther)
  }
}

export const unparkEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/unpark',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      // Nothing to say but where to go back to: undoing a park needs no reason,
      // because the park's reason is the thing being withdrawn.
      payload: Joi.object({
        from: Joi.string().allow('').default('')
      }).default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { from } = request.payload as { from?: string }
    const result = await unparkEventUseCase(key, toActor(request))

    return h
      .redirect(toRedirect(key, toSafeFrom(from), result, ['unparked', '1']))
      .code(seeOther)
  }
}
