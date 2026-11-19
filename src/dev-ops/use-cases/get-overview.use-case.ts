import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { Overview } from '../repositories/overview.repository.ts'
import { getOverview } from '../repositories/overview.repository.ts'
import { toGasFailure } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  ConfigFailed,
  DeadLetters,
  FailedVersion,
  ListLink,
  Overview,
  OverviewCount,
  OverviewPart,
  OverviewSourceError,
  PerService,
  TokensExpiring,
  TopError,
  TopErrors
} from '../repositories/overview.repository.ts'

/**
 * - `read`: GAS answered, each part read or saying why not.
 * - `failed`: GAS couldn't be reached, or didn't answer, or answered with an error.
 */
export type OverviewResult =
  | { outcome: 'read'; overview: Overview }
  | { outcome: 'failed'; failure: GasFailure }

export const getOverviewUseCase = async (): Promise<OverviewResult> => {
  try {
    return { outcome: 'read', overview: await getOverview() }
  } catch (error) {
    logger.error(
      `Could not read the overview from fg-gas-backend: ${describeError(error)}`
    )

    return { outcome: 'failed', failure: toGasFailure(error) }
  }
}
