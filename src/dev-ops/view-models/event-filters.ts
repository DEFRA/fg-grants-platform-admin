import Joi from 'joi'

import type {
  EventCounts,
  EventService
} from '../use-cases/get-events.use-case.ts'

/**
 * The statuses a row can be in, in the order a message travels through them.
 * This is the same list fg-gas-backend validates `?status=` against
 * (`EVENT_STATUSES`, src/common/status-counts.js there): a status the toolbar
 * offers that the endpoint refuses is a segment that can only ever be an
 * error, and one the endpoint accepts that this app refuses is a page an
 * operator cannot reach. Typed as the counts' own keys, because every segment
 * wears its count.
 */
const eventStatuses: (keyof EventCounts)[] = [
  'PUBLISHED',
  'PROCESSING',
  'FAILED',
  'RESUBMITTED',
  'COMPLETED',
  'DEAD_LETTER'
]

/** The two services the platform has, as the endpoint spells them. */
const eventServices: { value: EventService; label: string }[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * Absent is `exclude`, the page an operator opens by default. Both values are
 * accepted so a link may say either explicitly; the app only ever writes
 * `include`, because the default needs no parameter.
 */
const auditModes = ['include', 'exclude'] as const

/**
 * These ARE validated, unlike the free-text parameters beside them: a
 * `?status=dead-letter` typed by hand went through to fg-gas-backend, came
 * back 400, and was drawn as "Events could not be loaded from GAS" — a typo
 * reported as an outage on the page operators open to find out whether there
 * is one.
 *
 * Exact values only, with no case-folding: a url that means one thing here
 * and another at the endpoint is worse than one that is simply wrong. Empty
 * is not a value either — both filters are links, so `?status=` is a url
 * nobody issued rather than a box somebody emptied.
 */
export const eventEnumFilters = {
  status: Joi.string().valid(...eventStatuses),
  service: Joi.string().valid(...eventServices.map(({ value }) => value)),
  audit: Joi.string().valid(...auditModes)
}
