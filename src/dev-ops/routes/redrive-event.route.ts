import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { redriveEventUseCase } from '../use-cases/redrive-event.use-case.ts'
import { eventAddress } from '../view-models/event-address.ts'
import { toEventHref } from '../view-models/event-formats.ts'
import {
  redriveNoticeKey,
  toSafeFrom
} from '../view-models/event-page.view-model.ts'
import { toActor } from '../view-models/actor.ts'

/**
 * See other: the browser follows a write with a GET, so a reload of the page
 * that lands never re-submits the redrive. Spelled out here because a route
 * may not reach into common/status-codes.ts.
 */
const seeOther = 303

/**
 * The page the operator was on, and nothing about the outcome: a parameter
 * saying how it went would be repeated by every refresh of the page it lands
 * on. The outcome rides the session instead, which is spent on one render.
 */
const toRedirect = (key: EventKey, from: string): string => {
  const href = toEventHref(key)

  return from === '' ? href : `${href}?from=${encodeURIComponent(from)}`
}

/**
 * The one write this app makes.
 *
 * No CSRF token, deliberately and not by omission — but the defence is the
 * cookie, not the harmlessness of the write. A forged request could redrive
 * ANY dead letter and put the victim's name on it, because `x-actor` is read
 * off their session: that is a real thing to stop, and what stops it is
 * `isSameSite: 'Strict'` on the session cookie, pinned explicitly in
 * server/plugins/session-cache/index.ts so it cannot drift into a default.
 * A cross-site POST simply arrives without the cookie, so it never reaches
 * the scope check, let alone the queue.
 *
 * A crumb here would be a token in one place out of one, which is the shape
 * of a defence that quietly stops working.
 *
 * No `options.auth` for the same reason as its neighbours: src/dev-ops/index.ts
 * registers this through `scopedTo`, and that helper only scopes a route that
 * declares no auth of its own.
 */
/** Longer than any query this app builds for itself, and still bounded. */
const fromMax = 2048

export const redriveEventRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/{service}/{box}/{id}/redrive',
  options: {
    validate: {
      params: Joi.object(eventAddress),
      // The form carries one field, and only so the page it returns to is the
      // page the operator started from. An absent or hostile value is dropped
      // by `toSafeFrom`, exactly as it is on the inspect page itself, and it
      // is bounded because it is echoed into the redirect.
      //
      // `.empty(null)` earns its place: hapi hands a body-less POST a payload
      // of `null`, and a Joi `default` only fires on `undefined` - so without
      // it, a POST with no body at all was a 400 rather than the "redrive and
      // go back to the plain list" this claims to accept.
      payload: Joi.object({
        from: Joi.string().allow('').max(fromMax).default('')
      })
        .empty(null)
        .default({})
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const key = request.params as unknown as EventKey
    const { from } = request.payload as { from?: string }
    const result = await redriveEventUseCase(key, toActor(request))

    request.yar.flash(redriveNoticeKey, { ...result, page: toEventHref(key) })

    return h.redirect(toRedirect(key, toSafeFrom(from))).code(seeOther)
  }
}
