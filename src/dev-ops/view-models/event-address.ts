import Joi from 'joi'

import type {
  EventBox,
  EventKey,
  EventService
} from '../use-cases/get-event.use-case.ts'

const urlServices: Record<EventService, string> = {
  gas: 'gas',
  caseworking: 'cw'
}

/** A service as an event's URL spells it: CW's events are under `cw`, as its lists are. */
export const toUrlService = (service: EventService): string =>
  urlServices[service]

/** The event an address checked by `eventAddress` names, with the service as fg-gas-backend spells it. */
export const toEventKey = ({
  service,
  box,
  id
}: Record<string, string>): EventKey => ({
  service: service === urlServices.caseworking ? 'caseworking' : 'gas',
  box: box as EventBox,
  id
})

/**
 * The address of one event as its URL spells it, and the only thing the
 * routes on that address share.
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
  service: Joi.string()
    .valid(...Object.values(urlServices))
    .required(),
  box: Joi.string().valid('inbox', 'outbox').required(),
  id: Joi.string()
    .pattern(/^[0-9a-f]{24}$/)
    .required()
}
