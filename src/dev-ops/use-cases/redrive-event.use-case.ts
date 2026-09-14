import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { redriveEvent } from '../repositories/events.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

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
}

/** A timeout leaves the redrive's outcome unknown: CW-BE may still have applied it. */
const failureOutcomes: Record<number, RedriveOutcome> = {
  [statusCodes.notFound]: 'not-found',
  [statusCodes.gatewayTimeout]: 'timed-out'
}

const toConflict = (error: unknown): RedriveResult => ({
  outcome: 'conflict',
  status:
    toGasErrorField(error, 'statusLabel') ?? toGasErrorField(error, 'status')
})

const toFailureOutcome = (statusCode: number | null): RedriveOutcome =>
  (statusCode === null ? undefined : failureOutcomes[statusCode]) ??
  'unavailable'

const toOutcome = (error: unknown): RedriveResult => {
  const statusCode = toGasStatusCode(error)

  return statusCode === statusCodes.conflict
    ? toConflict(error)
    : { outcome: toFailureOutcome(statusCode), status: null }
}

/** `actor` goes to the backend on `x-actor`, so the audit record names a person. */
export const redriveEventUseCase = async (
  key: EventKey,
  actor?: string
): Promise<RedriveResult> => {
  try {
    await redriveEvent(key, actor)

    return { outcome: 'redriven', status: null }
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
