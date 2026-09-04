import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { getBatchEventsUseCase } from '../use-cases/get-batch-events.use-case.ts'
import { redriveEventsUseCase } from '../use-cases/redrive-event.use-case.ts'
import { toEventKey } from '../view-models/event-address.ts'
import { toSafeFrom } from '../view-models/event-page.view-model.ts'
import {
  toRedriveConfirm,
  toRedriveResults
} from '../view-models/redrive-batch.view-model.ts'
import { toActor } from '../view-models/actor.ts'

/**
 * How many events one batch may carry.
 *
 * Not a technical limit — the loop would happily run to a hundred — but the
 * limit of what a person can actually check on a confirmation page before they
 * press the button. Twenty is one screen of rows and one keyset page of the
 * list, so the cap and the page an operator selected from are the same size.
 */
const maxBatchSize = 20

/**
 * The selected ids, flattened and counted.
 *
 * A plain row submits one address; a group summary submits every member's,
 * comma-joined, because a checkbox carries one value and a retry storm is one
 * thing an operator wants to act on. Both arrive here as the same list, and
 * the cap is applied to what they add up to rather than to how many boxes were
 * ticked — eight groups of eight is not eight events.
 */
const toIds = (values: string[]): string[] =>
  values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')

const selectedIds = Joi.array()
  .items(Joi.string().max(200))
  .single()
  .min(1)
  .required()
  .custom((values: string[], helpers) => {
    const ids = toIds(values)

    return ids.length > maxBatchSize
      ? helpers.error('array.max', { limit: maxBatchSize })
      : ids
  })

/**
 * Every selected address, validated exactly as a single-event url is.
 *
 * A value that is not one is dropped rather than refused: the form is built by
 * this app and a malformed value in it is not something an operator can
 * meaningfully be told about, while a 400 would lose the whole selection over
 * one bad string. Anything real that was selected still goes through, and an
 * empty result is a page that says nothing was selected.
 */
const toKeys = (ids: string[]): EventKey[] =>
  ids.flatMap((id) => {
    const key = toEventKey(id)

    return key === null ? [] : [key]
  })

/**
 * The bulk write, in two stages and one route.
 *
 * Stage one renders what is about to happen; stage two, reached only by
 * posting the confirmation, does it. Both are POSTs on purpose: the selection
 * is a set of up to twenty ids and has no business being a url anyone can
 * bookmark, share or reload — and the confirmation exists precisely because
 * the second POST writes to a queue.
 *
 * No CSRF token, for the same reason the single-event redrive carries none:
 * this app has no crumb machinery anywhere, the route sits behind the session
 * strategy and the `FCP.GrantOperationsAdmin` scope, and the worst a forged
 * request could do is re-queue messages that were already meant to be
 * re-queued. A defence added in one place out of two is a defence that quietly
 * stops working.
 *
 * No `options.auth` for the same reason as its neighbours: src/dev-ops/index.ts
 * registers this through `scopedTo`, and that helper only scopes a route that
 * declares no auth of its own.
 */
export const redriveBatchRoute: ServerRoute = {
  method: 'POST',
  path: '/dev-ops/events/redrive-batch',
  options: {
    validate: {
      // One flag, written by this app's own confirmation form and by nothing
      // else. Its presence is the whole difference between the two stages.
      query: Joi.object({ confirmed: Joi.string() }),
      payload: Joi.object({
        id: selectedIds,
        from: Joi.string().allow('').default('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const { id, from } = request.payload as { id: string[]; from?: string }
    const { confirmed } = request.query as { confirmed?: string }
    const keys = toKeys(id)
    const safeFrom = toSafeFrom(from)

    if (confirmed) {
      return h.view('events-redrive-results', {
        pageTitle: 'Redrive results',
        ...toRedriveResults(
          await redriveEventsUseCase(keys, toActor(request)),
          safeFrom
        )
      })
    }

    return h.view('events-redrive-confirm', {
      pageTitle: 'Redrive selected events',
      ...toRedriveConfirm(await getBatchEventsUseCase(keys), safeFrom)
    })
  }
}
