import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import { eventEnumFilters } from '../view-models/event-filters.ts'
import type { EventsPageQuery } from '../view-models/events-page.view-model.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'

/**
 * What a `datetime-local` box submits: a wall clock with no zone on it at all,
 * to the minute or to the second depending on what the operator typed.
 */
const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** The ceiling fg-gas-backend stores `lastError.message` under. */
const errorMax = 1024

/**
 * The wall clock the box submitted, read as UTC. A `datetime-local` input has
 * no timezone; the boxes are labelled `(UTC)` and this is where that label is
 * made true — an operator in London in summer would otherwise be quietly
 * asking about an hour either side of the one they typed.
 */
const toUtcDate = (value: string, seconds: string | undefined): Date =>
  new Date(`${value}${seconds ? '' : ':00'}Z`)

/**
 * Whether a `datetime-local` value names a day that exists. A month of `13`
 * gives an Invalid Date whose `toISOString()` throws; `2026-02-30` is worse —
 * JavaScript rolls it forward to March 2 without complaint. Both are caught
 * the same way: parse it, then check the instant spells itself back.
 */
const isRealDatetime = (
  value: string,
  seconds: string | undefined
): boolean => {
  const date = toUtcDate(value, seconds)

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(seconds ? value : `${value}:00`)
  )
}

/**
 * A range box's value: a local datetime this app reads as UTC, or anything
 * else — an instant off a shared url — which is fg-gas-backend's to judge.
 * The check lives in validation so an impossible date is a 400 like every
 * other bad parameter, not an exception on the way to the endpoint.
 */
const rangeBox = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    const match = datetimeLocal.exec(value)

    return match === null || isRealDatetime(value, match[1])
      ? value
      : helpers.error('any.invalid')
  })

const toInstant = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const match = datetimeLocal.exec(value)

  // Unreal dates are refused by `rangeBox` before they reach here; the guard
  // stays so this can only ever hand on a string, never throw.
  if (match === null || !isRealDatetime(value, match[1])) {
    return value
  }

  return toUtcDate(value, match[1]).toISOString()
}

const present = (name: string, value: string | undefined) =>
  value ? { [name]: value } : {}

const toQuery = ({
  q,
  error,
  from,
  to,
  ...rest
}: EventsPageQuery): EventsPageQuery => ({
  ...rest,
  ...present('q', q?.trim()),
  // Never trimmed, unlike the search: `error` matches a stored message
  // exactly, and a message may legitimately end in whitespace.
  ...present('error', error),
  ...present('from', toInstant(from)),
  ...present('to', toInstant(to))
})

/**
 * The endpoint's half of the query. `range` is this app's own label and
 * fg-gas-backend answers 400 for a parameter it does not know, so it is
 * taken off here.
 */
const toGasQuery = ({ range, ...gas }: EventsPageQuery): EventsQuery => gas

/**
 * The enums — `status`, `service`, `direction` — are checked against the
 * values this app itself offers; see view-models/event-filters.ts for why.
 * Everything else is unconstrained — a cursor is opaque and genuinely the
 * endpoint's to refuse, and the search and failure message are free text.
 * Unknown keys are rejected by Joi's default, which catches a typo'd link.
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
        direction: Joi.string().valid('forward', 'backward'),
        ...eventEnumFilters,
        // Empty is allowed through validation so a cleared search box is a
        // page, not the shared govuk error screen; `toQuery` then drops it.
        q: Joi.string().allow(''),
        // Capped where the store caps the message: a longer needle can match
        // nothing, and refusing it here is this app's own 400 rather than an
        // outage-shaped one from GAS.
        error: Joi.string().allow('').max(errorMax),
        from: rangeBox,
        to: rangeBox,
        // This app's own parameter, stripped before the query reaches GAS.
        range: Joi.string().allow('')
      })
    }
  },
  async handler(request: Request, h: ResponseToolkit) {
    const query = toQuery(request.query as unknown as EventsPageQuery)

    return h.view('events', {
      pageTitle: 'Events',
      ...toEventsPage(await getEventsUseCase(toGasQuery(query)), query)
    })
  }
}
