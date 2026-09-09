import type { EventsQuery } from '../repositories/events.repository.ts'

/**
 * Whether this page is about dead letters at all — narrowed to them, or
 * narrowed to nothing. Every other status has no question for the failure
 * breakdown to answer.
 *
 * Both halves of the page read this one condition: the use case decides
 * whether to ask fg-gas-backend for the breakdown (asking anyway would be a
 * third read on every page load for a panel that could never be drawn), and
 * the view model decides whether to compose the panel from what came back.
 * Written twice, the two eventually answer differently — and the failure mode
 * is silent: a panel with nothing in it, or a read nobody uses.
 */
export const showsDeadLetterContent = ({
  status
}: Pick<EventsQuery, 'status'>): boolean => !status || status === 'DEAD_LETTER'
