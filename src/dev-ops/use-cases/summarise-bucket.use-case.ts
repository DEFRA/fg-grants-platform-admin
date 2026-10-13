import type {
  BucketEntry,
  SummaryQuery,
  SummaryResult
} from '../repositories/buckets.repository.ts'
import { summariseBucket } from '../repositories/buckets.repository.ts'
import type { ListResult } from './record-reads.ts'
import { readList } from './record-reads.ts'

export type {
  SummaryEntry,
  SummaryQuery,
  SummaryResult
} from '../repositories/buckets.repository.ts'

export type SummaryRead = ListResult<SummaryResult | null>

export const summariseBucketUseCase = async (
  bucket: BucketEntry,
  summaryId: string,
  query: SummaryQuery
): Promise<SummaryRead> =>
  readList(
    `bucket ${bucket.id} ${summaryId}`,
    () => summariseBucket(bucket.id, summaryId, query),
    null
  )
