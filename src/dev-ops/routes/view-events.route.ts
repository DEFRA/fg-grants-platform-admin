import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'
import Joi from 'joi'

import type { EventsQuery } from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'
import type { EventsPageQuery } from '../view-models/events-page.view-model.ts'
import { toEventsPage } from '../view-models/events-page.view-model.ts'

/**
 * What a `datetime-local` box submits: a wall clock with no zone on it at all,
 * to the minute or to the second depending on what the operator typed.
 */
const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * The range boxes' value, as an instant.
 *
 * A `datetime-local` input has no timezone — it submits `2026-06-16T09:00`
 * and means whatever the person typing it meant. The boxes are labelled
 * `(UTC)` and this is where that label is made true: the value is read as UTC
 * and handed on as the ISO instant the endpoint takes. An operator in London
 * in summer would otherwise be quietly asking about an hour either side of the
 * one they typed, and the whole point of a range is that its edges are exact.
 *
 * Anything that is not a local datetime is passed through untouched — a `from`
 * shared in a url is already an instant, and a value that is neither is GAS's
 * to refuse, exactly as an unknown status is.
 */
const toInstant = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  const match = datetimeLocal.exec(value)

  if (match === null) {
    return value
  }

  return new Date(`${value}${match[1] ? '' : ':00'}Z`).toISOString()
}

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
 * `q` is the one parameter this route touches at all, and only to normalise
 * it: the search box submits `q=` when it is cleared with the keyboard, and
 * the endpoint answers 400 for an empty needle. An empty search is simply no
 * search, so it is dropped here rather than turned into an error alert about
 * a query the operator did not knowingly make.
 *
 * `from` and `to` are normalised for a related reason: the two boxes submit
 * empty when they are cleared, and a local datetime when they are not. Neither
 * is a thing GAS can read, so both are turned into an instant or into nothing.
 *
 * No `options.auth` here on purpose: src/dev-ops/index.ts registers this route
 * through `scopedTo('FCP.GrantOperationsAdmin', …)`, and that helper only
 * applies the scope to a route that declares none of its own. Adding an `auth`
 * key below would silently unscope the page.
 */
/** A parameter that has something in it, or nothing at all. */
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
  // Never trimmed, unlike the search: `error` matches a stored message exactly,
  // and a message may legitimately end in whitespace. Empty is dropped for the
  // same reason an empty search is — a filter matching nothing in particular.
  ...present('error', error),
  ...present('from', toInstant(from)),
  ...present('to', toInstant(to))
})

/**
 * The endpoint's half of the query. `range` is this app's own label for the
 * window and means nothing to fg-gas-backend, which answers 400 for a
 * parameter it does not know - so it is taken off here rather than at the
 * repository, where a forgotten key would be a 400 on every page load.
 */
const toGasQuery = ({ range, ...gas }: EventsPageQuery): EventsQuery => gas

export const viewEventsRoute: ServerRoute = {
  method: 'GET',
  path: '/dev-ops/events',
  options: {
    validate: {
      query: Joi.object({
        cursor: Joi.string(),
        direction: Joi.string(),
        status: Joi.string(),
        service: Joi.string(),
        // Empty is allowed through validation so a cleared search box is a
        // page, not the shared govuk error screen; `toQuery` then drops it.
        q: Joi.string().allow(''),
        // The whole of a stored failure message, handed back by the failures
        // panel exactly as it was reported. Long, unconstrained and allowed to
        // be empty for the same reason `q` is.
        error: Joi.string().allow(''),
        // Both range boxes submit empty when they are cleared, for the same
        // reason and with the same answer.
        from: Joi.string().allow(''),
        to: Joi.string().allow(''),
        // The name of the preset the window came off, carried so the control
        // can say `Last 24h` rather than the instant that means. This app's
        // own parameter: it is stripped before the query reaches
        // fg-gas-backend, which would refuse it as an unknown one.
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
