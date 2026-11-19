import type { RequestApplicationState } from '@hapi/hapi'

import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { Catalogue } from '../repositories/buckets.repository.ts'
import { findShell } from '../repositories/shell.repository.ts'

export type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'

const shellOf = ({ app }: { app?: RequestApplicationState }) =>
  app?.upstream?.shell

/**
 * The lists GAS's answer to this request listed, or none. A handler asks
 * after its own call, which is what brought them.
 */
export const shellCatalogue = (request: {
  app?: RequestApplicationState
}): Catalogue | null => shellOf(request)?.catalogue ?? null

/** For a page drawn without asking GAS anything: the answer is kept with the request's own. */
export const readShellUseCase = async (): Promise<void> => {
  try {
    await findShell()
  } catch (error) {
    logger.error(
      `Could not read the shell from fg-gas-backend: ${describeError(error)}`
    )
  }
}
