import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import {
  isUnanswered,
  toGasErrorField,
  toGasFailure,
  toGasStatusCode
} from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  Counterpart,
  ListTotal,
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from '../repositories/record-page.ts'
export { recordTabs } from '../repositories/record-page.ts'

/**
 * A list read: the page, GAS refusing the parameters (a 400 is a bad link,
 * not an outage; its reason is fixed text that never repeats what was sent),
 * or how the read failed. A list has one source, so a failed read has no rows.
 */
export type ListResult<P> =
  | { kind: 'read'; page: P }
  | { kind: 'refused'; refusal: string | null }
  | { kind: 'failed'; failure: GasFailure }

const logListFailure = (name: string, refused: boolean, error: unknown) => {
  if (refused) {
    logger.warn(
      `fg-gas-backend refused the ${name} list parameters: ${describeError(error)}`
    )

    return
  }

  logger.error(
    `Could not read the ${name} list from fg-gas-backend: ${describeError(error)}`
  )
}

const isRefusal = (failure: GasFailure): boolean =>
  failure.kind === 'refused' && failure.statusCode === statusCodes.badRequest

/** How a list read failed: GAS refusing the parameters, or failing. */
export const toFailedList = <P>(
  error: unknown,
  name: string
): ListResult<P> => {
  const failure = toGasFailure(error)
  const refused = isRefusal(failure)

  logListFailure(name, refused, error)

  return refused
    ? { kind: 'refused', refusal: toGasErrorField(error, 'message') }
    : { kind: 'failed', failure }
}

export type RecordOutcome = 'found' | 'not-found' | 'timed-out' | 'unavailable'

export interface RecordResult<P> {
  outcome: RecordOutcome
  page: P | null
  /** How a read that timed out or was unavailable failed. */
  failure?: GasFailure
}

/** A tab for a file the record has not got is hidden, not empty. */
export interface HiddenTab {
  outcome: 'hidden'
  page: null
  failure?: undefined
}

/** Only the backend's own miss is a missing record; a bare 404 is a route GAS has not got. */
export const isMissing = (error: unknown, reason: string): boolean =>
  toGasStatusCode(error) === statusCodes.notFound &&
  toGasErrorField(error, 'reason') === reason

/** The ref is in the URL already, so no log line repeats it. */
export const readRecord = async <P>(
  name: string,
  read: () => Promise<P>,
  notFoundReason: string
): Promise<RecordResult<P>> => {
  try {
    return { outcome: 'found', page: await read() }
  } catch (error) {
    if (isMissing(error, notFoundReason)) {
      logger.info(`No such ${name} in fg-gas-backend`)

      return { outcome: 'not-found', page: null }
    }

    logger.error(
      `Could not read a ${name} from fg-gas-backend: ${describeError(error)}`
    )

    const failure = toGasFailure(error)

    return {
      outcome: isUnanswered(failure) ? 'timed-out' : 'unavailable',
      page: null,
      failure
    }
  }
}
