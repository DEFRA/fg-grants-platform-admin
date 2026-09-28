import type { EventDetail } from '../use-cases/get-event.use-case.ts'

export interface EventState {
  completed: boolean
  deadLetter: boolean
  purged: boolean
  redrivenSinceAttempts: boolean
  waiting: boolean
}

/** GAS clears the history on redrive but keeps the last error and resubmission. */
const isRedrivenSinceAttempts = (event: EventDetail): boolean =>
  event.lastRedrive !== null && event.attemptHistory.length === 0

export const isCompletedStatus = (status: string): boolean =>
  status === 'COMPLETED'

export const isDeadLetterStatus = (status: string): boolean =>
  status === 'DEAD_LETTER'

export const isPurgedStatus = (status: string): boolean => status === 'PURGED'

export const toEventState = (event: EventDetail): EventState => {
  const completed = isCompletedStatus(event.status)
  const redrivenSinceAttempts = !completed && isRedrivenSinceAttempts(event)

  return {
    completed,
    deadLetter: isDeadLetterStatus(event.status),
    purged: isPurgedStatus(event.status),
    redrivenSinceAttempts,
    waiting: !completed && !redrivenSinceAttempts
  }
}
