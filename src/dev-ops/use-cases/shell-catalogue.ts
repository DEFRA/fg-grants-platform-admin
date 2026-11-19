import type { RequestApplicationState } from '@hapi/hapi'

import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'
import { findShell } from '../repositories/shell.repository.ts'
import { isQueueAddress } from './list-bucket.use-case.ts'

export type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'

const shellOf = ({ app }: { app?: RequestApplicationState }) =>
  app?.upstream?.shell

const isDrawn = ({ path }: BucketEntry): boolean => !isQueueAddress(path)

const toDrawn = (catalogue: Catalogue): Catalogue => ({
  ...catalogue,
  buckets: catalogue.buckets.filter(isDrawn)
})

/**
 * The lists GAS's answer to this request listed, but a queue's own, or none.
 * A handler asks after its own call, which is what brought them.
 */
export const shellCatalogue = (request: {
  app?: RequestApplicationState
}): Catalogue | null => {
  const catalogue = shellOf(request)?.catalogue

  return catalogue ? toDrawn(catalogue) : null
}

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
