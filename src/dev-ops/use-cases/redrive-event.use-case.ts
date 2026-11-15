import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { redriveEvent } from '../repositories/events.repository.ts'
import {
  isUnanswered,
  toGasErrorField,
  toGasFailure,
  toGasStatusCode
} from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

/** `conflict`: the event is no longer dead-lettered, so the page names the state it is in. */
export type RedriveOutcome =
  | 'redriven'
  | 'conflict'
  | 'not-found'
  | 'timed-out'
  | 'unavailable'

export interface RedriveResult {
  outcome: RedriveOutcome
  /** Only a conflict reports one. */
  status: string | null
  /** Only a redrive that went unanswered or failed reports one. */
  failure: GasFailure | null
}

const failureOutcomes: Record<number, RedriveOutcome> = {
  [statusCodes.notFound]: 'not-found'
}

const toConflict = (error: unknown): RedriveResult => ({
  outcome: 'conflict',
  status:
    toGasErrorField(error, 'statusLabel') ?? toGasErrorField(error, 'status'),
  failure: null
})

const toFailed = (error: unknown, outcome: RedriveOutcome): RedriveResult => ({
  outcome,
  status: null,
  failure: outcome === 'unavailable' ? toGasFailure(error) : null
})

const toFailureOutcome = (statusCode: number | null): RedriveOutcome =>
  (statusCode === null ? undefined : failureOutcomes[statusCode]) ??
  'unavailable'

/** A redrive nobody answered leaves its outcome unknown: it may still have been applied. */
const toOutcome = (error: unknown): RedriveResult => {
  const failure = toGasFailure(error)

  if (isUnanswered(failure)) {
    return { outcome: 'timed-out', status: null, failure }
  }

  const statusCode = toGasStatusCode(error)

  return statusCode === statusCodes.conflict
    ? toConflict(error)
    : toFailed(error, toFailureOutcome(statusCode))
}

/** `actor` goes to the backend on `x-actor`, so the audit record names a person. */
export const redriveEventUseCase = async (
  key: EventKey,
  actor?: string
): Promise<RedriveResult> => {
  try {
    await redriveEvent(key, actor)

    return { outcome: 'redriven', status: null, failure: null }
  } catch (error) {
    const result = toOutcome(error)
    const where = `${key.service}/${key.box}/${key.id}`

    // The event moved on or went away: expected, so a warning, not an error.
    if (result.outcome === 'conflict' || result.outcome === 'not-found') {
      logger.warn(`Did not redrive event ${where}: ${result.outcome}`)

      return result
    }

    logger.error(
      `Could not redrive event ${where} in fg-gas-backend: ${describeError(error)}`
    )

    return result
  }
}
