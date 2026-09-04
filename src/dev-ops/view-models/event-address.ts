import Joi from 'joi'

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
 *
 * It was also the schema the batch form's flattened `service:box:id` values
 * were split back apart against. There is no batch form any more: a redrive is
 * made from one event's own page, at its own address.
 */
export const eventAddress = {
  service: Joi.string().valid('gas', 'caseworking').required(),
  box: Joi.string().valid('inbox', 'outbox').required(),
  id: Joi.string()
    .pattern(/^[0-9a-f]{24}$/)
    .required()
}
