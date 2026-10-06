import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  ApplicationPage,
  ApplicationRef,
  ApplicationTab
} from '../repositories/applications.repository.ts'
import { findApplicationPage } from '../repositories/applications.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

export type {
  ApplicationPage,
  ApplicationRef,
  ApplicationTab
} from '../repositories/applications.repository.ts'
export { applicationTabs } from '../repositories/applications.repository.ts'

export type ApplicationOutcome =
  | 'found'
  | 'not-found'
  | 'timed-out'
  | 'unavailable'

export interface ApplicationResult {
  outcome: ApplicationOutcome
  page: ApplicationPage | null
}

const applicationNotFound = 'APPLICATION_NOT_FOUND'

/** Only GAS's own miss is a missing application; a bare 404 is a route GAS has not got. */
const isMissing = (error: unknown): boolean =>
  toGasStatusCode(error) === statusCodes.notFound &&
  toGasErrorField(error, 'reason') === applicationNotFound

const toFailure = (error: unknown): ApplicationOutcome =>
  toGasStatusCode(error) === statusCodes.gatewayTimeout
    ? 'timed-out'
    : 'unavailable'

/** The ref is in the URL already, so no log line repeats it. */
export const getApplicationPageUseCase = async (
  ref: ApplicationRef,
  tab: ApplicationTab
): Promise<ApplicationResult> => {
  try {
    return { outcome: 'found', page: await findApplicationPage(ref, tab) }
  } catch (error) {
    if (isMissing(error)) {
      logger.info('No such application in fg-gas-backend')

      return { outcome: 'not-found', page: null }
    }

    logger.error(
      `Could not read an application's ${tab} from fg-gas-backend: ${describeError(error)}`
    )

    return { outcome: toFailure(error), page: null }
  }
}
