import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  DefinitionFetchFile,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { fetchGrantDefinitions } from '../repositories/grants.repository.ts'
import { toGasStatusCode } from './gas-status.ts'

export type {
  DefinitionFetchFile,
  DefinitionFetchReason
} from '../repositories/grants.repository.ts'

/**
 * `fetched`: GAS answered for every file it tried, failed ones included.
 * `timed-out` leaves it unknown what GAS stored; `unavailable` may follow a
 * fetch that stopped part-way, after some files were stored.
 */
export type DefinitionFetchOutcome =
  | 'fetched'
  | 'not-found'
  | 'timed-out'
  | 'unavailable'

export interface DefinitionFetchResult {
  outcome: DefinitionFetchOutcome
  /** Only a `fetched` outcome lists any. */
  files: DefinitionFetchFile[]
}

const failureOutcomes: Record<number, DefinitionFetchOutcome> = {
  [statusCodes.notFound]: 'not-found',
  [statusCodes.gatewayTimeout]: 'timed-out'
}

const toFailureOutcome = (error: unknown): DefinitionFetchOutcome => {
  const statusCode = toGasStatusCode(error)

  return (
    (statusCode === null ? undefined : failureOutcomes[statusCode]) ??
    'unavailable'
  )
}

export const fetchGrantDefinitionsUseCase = async (
  ref: GrantVersionRef,
  actor?: string
): Promise<DefinitionFetchResult> => {
  try {
    const { files } = await fetchGrantDefinitions(ref, actor)

    return { outcome: 'fetched', files }
  } catch (error) {
    const outcome = toFailureOutcome(error)
    const where = `grant ${ref.code}@${ref.version}`

    if (outcome === 'not-found') {
      logger.warn(`Did not fetch definitions of ${where}: ${outcome}`)
    } else {
      logger.error(
        `Could not fetch definitions of ${where} in fg-gas-backend: ${describeError(error)}`
      )
    }

    return { outcome, files: [] }
  }
}
