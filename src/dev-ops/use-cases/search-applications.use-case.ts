import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  ApplicationsPage,
  ApplicationsSearch
} from '../repositories/applications.repository.ts'
import { searchApplications } from '../repositories/applications.repository.ts'
import { toGasStatusCode } from './gas-status.ts'

export type {
  ApplicationRow,
  ApplicationsPage,
  ApplicationsSearch,
  ListTotal
} from '../repositories/applications.repository.ts'

export interface ApplicationsResult {
  page: ApplicationsPage
  unavailable: boolean
  refused: boolean
}

const noPage: ApplicationsPage = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: []
}

const logFailure = (refused: boolean, error: unknown): void => {
  if (refused) {
    logger.warn(
      `fg-gas-backend refused the applications list parameters: ${describeError(error)}`
    )

    return
  }

  logger.error(
    `Could not read the applications list from fg-gas-backend: ${describeError(error)}`
  )
}

/** The list has one source, so any failure leaves it empty; a 400 is a bad link, not an outage. */
export const searchApplicationsUseCase = async (
  search: ApplicationsSearch,
  repeat: boolean
): Promise<ApplicationsResult> => {
  try {
    return {
      page: await searchApplications(search, repeat),
      unavailable: false,
      refused: false
    }
  } catch (error) {
    const refused = toGasStatusCode(error) === statusCodes.badRequest

    logFailure(refused, error)

    return { page: noPage, unavailable: !refused, refused }
  }
}
