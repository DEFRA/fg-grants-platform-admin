import Joi from 'joi'

import type {
  EventCounts,
  EventService
} from '../use-cases/get-events.use-case.ts'

/**
 * The statuses a row can be in, in the order a message travels through them,
 * ending where a message that could not be delivered ends.
 *
 * This is the same list fg-gas-backend validates `?status=` against
 * (`EVENT_STATUSES`, src/common/status-counts.js there), and it is the list the
 * toolbar draws a segment for. One list, because a status the toolbar offers
 * that the endpoint refuses is a segment that can only ever be an error, and a
 * status the endpoint accepts that this app refuses is a page an operator
 * cannot reach.
 *
 * Typed as the counts' own keys, because every segment wears its count.
 */
export const eventStatuses: (keyof EventCounts)[] = [
  'PUBLISHED',
  'PROCESSING',
  'FAILED',
  'RESUBMITTED',
  'COMPLETED',
  'DEAD_LETTER'
]

/** The two services the platform has, as the endpoint spells them. */
export const eventServices: { value: EventService; label: string }[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * The enum filters, as Joi sees them.
 *
 * These *are* validated here, unlike the free-text ones beside them, and the
 * reason is what an operator sees when they are not. A `?status=dead-letter`
 * typed by hand — or a link written by somebody who guessed the spelling —
 * went through to fg-gas-backend, came back 400, and was drawn as "Events
 * could not be loaded from GAS": a typo reported as an outage, on the page
 * operators open to find out whether there is an outage. The value is this
 * app's own to check, because this app is the one that offers the vocabulary.
 *
 * Exact values only, with no case-folding: `?status=dead_letter` is refused
 * rather than quietly corrected. A url that means one thing here and another
 * at the endpoint is worse than a url that is simply wrong, and every link the
 * app writes is already in the right case.
 *
 * Empty is not a value either. Neither filter has a control that can be
 * cleared — both are links, and a link either carries the filter or does not —
 * so `?status=` is a url nobody issued rather than a box somebody emptied.
 */
export const eventEnumFilters = {
  status: Joi.string().valid(...eventStatuses),
  service: Joi.string().valid(...eventServices.map(({ value }) => value))
}
