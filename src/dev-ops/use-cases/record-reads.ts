import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

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

const timedOutReason = 'TIMED_OUT'

export interface ListResult<P> {
  page: P
  unavailable: boolean
  refused: boolean
  /** GAS's own reason for a refusal: fixed text that never repeats what was sent. */
  refusal: string | null
  /** The read ran out of time in GAS or CW, which only a narrower one can mend. */
  timedOut: boolean
}

interface ListFailure {
  refused: boolean
  timedOut: boolean
}

/** A refusal and a read that ran out of time are answers the page explains, not outages. */
const logListFailure = (
  name: string,
  { refused, timedOut }: ListFailure,
  error: unknown
) => {
  if (refused) {
    logger.warn(
      `fg-gas-backend refused the ${name} list parameters: ${describeError(error)}`
    )

    return
  }

  if (timedOut) {
    logger.warn(
      `fg-gas-backend ran out of time reading the ${name} list: ${describeError(error)}`
    )

    return
  }

  logger.error(
    `Could not read the ${name} list from fg-gas-backend: ${describeError(error)}`
  )
}

/** A list has one source, so any failure leaves it empty; a 400 is a bad link, not an outage. */
export const readList = async <P>(
  name: string,
  read: () => Promise<P>,
  empty: P
): Promise<ListResult<P>> => {
  try {
    return {
      page: await read(),
      unavailable: false,
      refused: false,
      refusal: null,
      timedOut: false
    }
  } catch (error) {
    const refused = toGasStatusCode(error) === statusCodes.badRequest
    const timedOut = toGasErrorField(error, 'reason') === timedOutReason

    logListFailure(name, { refused, timedOut }, error)

    return {
      page: empty,
      unavailable: !refused,
      refused,
      refusal: refused ? toGasErrorField(error, 'message') : null,
      timedOut
    }
  }
}

export type RecordOutcome = 'found' | 'not-found' | 'timed-out' | 'unavailable'

export interface RecordResult<P> {
  outcome: RecordOutcome
  page: P | null
}

/** A tab for a file the record has not got is hidden, not empty. */
export interface HiddenTab {
  outcome: 'hidden'
  page: null
}

/** Only the backend's own miss is a missing record; a bare 404 is a route GAS has not got. */
export const isMissing = (error: unknown, reason: string): boolean =>
  toGasStatusCode(error) === statusCodes.notFound &&
  toGasErrorField(error, 'reason') === reason

const toFailure = (error: unknown): RecordOutcome =>
  toGasStatusCode(error) === statusCodes.gatewayTimeout
    ? 'timed-out'
    : 'unavailable'

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

    return { outcome: toFailure(error), page: null }
  }
}
