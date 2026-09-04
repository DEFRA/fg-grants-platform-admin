import Joi from 'joi'

import type { EventKey } from '../repositories/events.repository.ts'

/**
 * The address of one event, exactly as fg-gas-backend spells it, and the only
 * thing the two routes on that address share.
 *
 * Unlike the list's query, these *are* validated. A path is not a filter: a
 * service or a box outside the two each admits is not a query the endpoint
 * might one day accept, it is a url nobody ever issued, and answering it with
 * a page-shaped error alert would be pretending we asked for it. The id is a
 * Mongo ObjectId, which is 24 hex characters and nothing else.
 *
 * It lives beside the view models rather than in either route because routes
 * do not import one another — and a validation contract stated twice is a
 * validation contract that will one day disagree with itself.
 */
export const eventAddress = {
  service: Joi.string().valid('gas', 'caseworking').required(),
  box: Joi.string().valid('inbox', 'outbox').required(),
  id: Joi.string()
    .pattern(/^[0-9a-f]{24}$/)
    .required()
}

const address = Joi.object(eventAddress)

/**
 * One event's address, as the batch form flattens it: `service:box:id`.
 *
 * A checkbox carries a single value, and the endpoint's key for a message is
 * three. Joining them is the only way twenty of these fit in one form, and
 * splitting them again is the only place the join is ever undone — validated
 * against the very same schema the two single-event routes validate their path
 * with, so a value someone typed into the form by hand is refused by exactly
 * the rules a url would have been.
 *
 * The id keeps whatever colons are left in it rather than the split throwing
 * them away: an id with a colon in it is not an ObjectId, and it is the
 * pattern's job to say so, not the parser's.
 */
export const toEventKey = (value: string): EventKey | null => {
  const [service, box, ...rest] = value.split(':')
  const { error, value: key } = address.validate({
    service,
    box,
    id: rest.join(':')
  })

  return error ? null : (key as EventKey)
}
