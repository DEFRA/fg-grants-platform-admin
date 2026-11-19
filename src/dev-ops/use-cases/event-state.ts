import type { EventDetail } from './get-event.use-case.ts'

export interface EventState {
  completed: boolean
  deadLetter: boolean
  purged: boolean
  redrivenSinceAttempts: boolean
  waiting: boolean
  /** GAS's gate: a dead letter, or a purged event, is redriven on asking. */
  redrivable: boolean
  /** GAS's gate: a dead letter it gives a deletion date for. */
  purgeable: boolean
}

/** GAS clears the history on redrive but keeps the last error and resubmission. */
const isRedrivenSinceAttempts = (event: EventDetail): boolean =>
  event.lastRedrive !== null && event.attemptHistory.length === 0

export const isCompletedStatus = (status: string): boolean =>
  status === 'COMPLETED'

/** Queued or being processed: on its way to completing, with no failed attempt yet. */
export const isInFlightStatus = (status: string): boolean =>
  status === 'PUBLISHED' || status === 'PROCESSING'

export const isDeadLetterStatus = (status: string): boolean =>
  status === 'DEAD_LETTER'

export const isPurgedStatus = (status: string): boolean => status === 'PURGED'

/** A deletion date of '' is none. */
const isPurgeable = ({ status, purgeDeletionDate }: EventDetail): boolean =>
  isDeadLetterStatus(status) && Boolean(purgeDeletionDate)

export const toEventState = (event: EventDetail): EventState => {
  const completed = isCompletedStatus(event.status)
  const redrivenSinceAttempts = !completed && isRedrivenSinceAttempts(event)
  const deadLetter = isDeadLetterStatus(event.status)
  const purged = isPurgedStatus(event.status)

  return {
    completed,
    deadLetter,
    purged,
    redrivenSinceAttempts,
    waiting: !completed && !redrivenSinceAttempts,
    redrivable: deadLetter || purged,
    purgeable: isPurgeable(event)
  }
}

/** The owning service sends a revision only once it can take an edit, so its presence is the capability. */
export const canEditEvent = (event: EventDetail, state: EventState): boolean =>
  state.redrivable && typeof event.payloadRevision === 'number'
