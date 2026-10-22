import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  DefinitionFetch,
  DefinitionFetchFile
} from '../repositories/config-versions.ts'
import { toGasStatusCode } from './gas-status.ts'

export type {
  DefinitionFetchFile,
  DefinitionFetchReason,
  VersionRef
} from '../repositories/config-versions.ts'

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

export interface DefinitionFetchResult<F extends string = string> {
  outcome: DefinitionFetchOutcome
  /** Only a `fetched` outcome lists any. */
  files: DefinitionFetchFile<F>[]
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

/** @param where The version, as a log line names it. */
export const fetchDefinitions = async <F extends string>(
  where: string,
  fetch: () => Promise<DefinitionFetch<F>>
): Promise<DefinitionFetchResult<F>> => {
  try {
    const { files } = await fetch()

    return { outcome: 'fetched', files }
  } catch (error) {
    const outcome = toFailureOutcome(error)

    if (outcome === 'not-found') {
      logger.warn(`Did not fetch ${where}: ${outcome}`)
    } else {
      logger.error(
        `Could not fetch ${where} in fg-gas-backend: ${describeError(error)}`
      )
    }

    return { outcome, files: [] }
  }
}
