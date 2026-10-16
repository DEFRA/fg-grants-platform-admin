import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'
import { findBuckets } from '../repositories/buckets.repository.ts'

export type {
  BucketColumn,
  BucketEntry,
  BucketFact,
  BucketFactValue,
  BucketRefKind,
  BucketSummary,
  Catalogue,
  FactValue
} from '../repositories/buckets.repository.ts'

const maxAgeMs = 60 * 1000

interface Kept {
  catalogue: Catalogue
  readAt: number
}

/** The last good copy: navigation is drawn from it on every page, so it costs no call per render. */
const held: { kept: Kept | null } = { kept: null }

export const forgetCatalogue = (): void => {
  held.kept = null
}

const isFresh = (kept: Kept | null): kept is Kept =>
  kept !== null && Date.now() - kept.readAt < maxAgeMs

/** A failed read answers the last good copy, or none. */
const read = async (): Promise<Catalogue | null> => {
  try {
    held.kept = { catalogue: await findBuckets(), readAt: Date.now() }
  } catch (error) {
    logger.error(
      `Could not read the bucket catalogue from fg-gas-backend: ${describeError(error)}`
    )
  }

  return held.kept?.catalogue ?? null
}

export const getCatalogueUseCase = async (): Promise<Catalogue | null> =>
  isFresh(held.kept) ? held.kept.catalogue : read()

export interface FoundBucket {
  /** False when no catalogue could be read, so a missing bucket says nothing. */
  available: boolean
  bucket: BucketEntry | null
}

/** The entry whose list is drawn at this path below the admin's root; a copy that has not got it is read once more. */
export const getBucketAtUseCase = async (
  path: string
): Promise<FoundBucket> => {
  const at = (catalogue: Catalogue | null) =>
    catalogue?.buckets.find((bucket) => bucket.path === path) ?? null
  const wasFresh = isFresh(held.kept)
  const kept = await getCatalogueUseCase()
  const catalogue = at(kept) === null && wasFresh ? await read() : kept

  return { available: catalogue !== null, bucket: at(catalogue) }
}
