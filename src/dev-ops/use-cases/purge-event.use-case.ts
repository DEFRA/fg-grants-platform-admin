import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventKey,
  PurgeReason
} from '../repositories/events.repository.ts'
import { purgeEvent } from '../repositories/events.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

/**
 * `conflict`: the event is no longer dead-lettered, so the page names the state it is in.
 * `rejected`: the backend answered and refused the request, which is not the same as being down.
 */
export type PurgeOutcome =
  | 'purged'
  | 'conflict'
  | 'not-found'
  | 'rejected'
  | 'timed-out'
  | 'unavailable'

export interface PurgeResult {
  outcome: PurgeOutcome
  /** Only a conflict reports one. */
  status: string | null
}

/** A timeout leaves the purge's outcome unknown: the owning service may still have applied it. */
const failureOutcomes: Record<number, PurgeOutcome> = {
  [statusCodes.notFound]: 'not-found',
  [statusCodes.gatewayTimeout]: 'timed-out'
}

const toConflict = (error: unknown): PurgeResult => ({
  outcome: 'conflict',
  status:
    toGasErrorField(error, 'statusLabel') ?? toGasErrorField(error, 'status')
})

const isClientError = (statusCode: number): boolean =>
  statusCode >= statusCodes.badRequest &&
  statusCode < statusCodes.internalServerError

const toFailureOutcome = (statusCode: number | null): PurgeOutcome => {
  if (statusCode === null) {
    return 'unavailable'
  }

  return (
    failureOutcomes[statusCode] ??
    (isClientError(statusCode) ? 'rejected' : 'unavailable')
  )
}

const toOutcome = (error: unknown): PurgeResult => {
  const statusCode = toGasStatusCode(error)

  return statusCode === statusCodes.conflict
    ? toConflict(error)
    : { outcome: toFailureOutcome(statusCode), status: null }
}

/** The backend answered: the event moved on, went away or the request was refused, so a warning, not an error. */
const warnedOutcomes = new Set<PurgeOutcome>([
  'conflict',
  'not-found',
  'rejected'
])

const toWarning = (result: PurgeResult, error: unknown): string =>
  result.outcome === 'rejected'
    ? `rejected with ${toGasStatusCode(error)}`
    : result.outcome

/** `actor` goes to the backend on `x-actor`, so `lastPurge` names a person. */
export const purgeEventUseCase = async (
  key: EventKey,
  reason: PurgeReason,
  actor?: string
): Promise<PurgeResult> => {
  try {
    await purgeEvent(key, reason, actor)

    return { outcome: 'purged', status: null }
  } catch (error) {
    const result = toOutcome(error)
    const where = `${key.service}/${key.box}/${key.id}`

    if (warnedOutcomes.has(result.outcome)) {
      logger.warn(`Did not purge event ${where}: ${toWarning(result, error)}`)

      return result
    }

    logger.error(
      `Could not purge event ${where} in fg-gas-backend: ${describeError(error)}`
    )

    return result
  }
}
