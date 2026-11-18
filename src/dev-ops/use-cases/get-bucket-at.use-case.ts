import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { BucketEntry } from '../repositories/buckets.repository.ts'
import { findShell } from '../repositories/shell.repository.ts'

export interface FoundBucket {
  /** False when no catalogue could be read, so a missing bucket says nothing. */
  available: boolean
  bucket: BucketEntry | null
}

/** The entry whose list is drawn at this path below the admin's root. */
export const getBucketAtUseCase = async (
  path: string
): Promise<FoundBucket> => {
  try {
    const { catalogue } = await findShell()

    return {
      available: true,
      bucket: catalogue.buckets.find((bucket) => bucket.path === path) ?? null
    }
  } catch (error) {
    logger.error(
      `Could not read the bucket catalogue from fg-gas-backend: ${describeError(error)}`
    )

    return { available: false, bucket: null }
  }
}
