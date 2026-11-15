import { catalogue } from '../test-fixtures.ts'
import type { FoundBucket } from '../get-bucket-at.use-case.ts'

export const getBucketAtUseCase = vi.fn(
  async (path: string): Promise<FoundBucket> => ({
    available: true,
    bucket: catalogue.buckets.find((bucket) => bucket.path === path) ?? null
  })
)
