import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

export type { RecordTab } from '../repositories/record-page.ts'
export { recordTabs } from '../repositories/record-page.ts'

export interface ListResult<P> {
  page: P
  unavailable: boolean
  refused: boolean
}

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

/** A list has one source, so any failure leaves it empty; a 400 is a bad link, not an outage. */
export const readList = async <P>(
  name: string,
  read: () => Promise<P>,
  empty: P
): Promise<ListResult<P>> => {
  try {
    return { page: await read(), unavailable: false, refused: false }
  } catch (error) {
    const refused = toGasStatusCode(error) === statusCodes.badRequest

    logListFailure(name, refused, error)

    return { page: empty, unavailable: !refused, refused }
  }
}

export type RecordOutcome = 'found' | 'not-found' | 'timed-out' | 'unavailable'

export interface RecordResult<P> {
  outcome: RecordOutcome
  page: P | null
}

/** Only the backend's own miss is a missing record; a bare 404 is a route GAS has not got. */
const isMissing = (error: unknown, reason: string): boolean =>
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
