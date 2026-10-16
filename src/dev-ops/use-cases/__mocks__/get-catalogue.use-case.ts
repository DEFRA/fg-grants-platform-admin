import { catalogue } from '../test-fixtures.ts'
import type { Catalogue, FoundBucket } from '../get-catalogue.use-case.ts'

/**
 * A stub rather than an automock: every dev-ops page draws its navigation from
 * the catalogue, so a test that renders one needs an answer here whether or
 * not it is about buckets.
 */
export const forgetCatalogue = vi.fn()

export const getCatalogueUseCase = vi.fn(
  async (): Promise<Catalogue | null> => catalogue
)

export const getBucketAtUseCase = vi.fn(
  async (path: string): Promise<FoundBucket> => ({
    available: true,
    bucket: catalogue.buckets.find((bucket) => bucket.path === path) ?? null
  })
)
