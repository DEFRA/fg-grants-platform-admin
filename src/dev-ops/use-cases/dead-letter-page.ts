import type { EventsQuery } from '../repositories/events.repository.ts'

/** The Top errors panel belongs only on a page narrowed to dead letters, or to nothing. */
export const showsDeadLetterContent = ({
  status
}: Pick<EventsQuery, 'status'>): boolean => !status || status === 'DEAD_LETTER'
