import type {
  BucketEntry,
  BucketQuery,
  BucketResult
} from '../repositories/buckets.repository.ts'
import { queryBucket } from '../repositories/buckets.repository.ts'
import type { ListResult } from './record-reads.ts'
import { readList } from './record-reads.ts'

export type {
  BucketCell,
  BucketGroup,
  BucketGroupValue,
  BucketLink,
  BucketPaging,
  BucketPlan,
  BucketResult,
  BucketRow
} from '../repositories/buckets.repository.ts'

/** The URL's filters, the stored search and the place a later page starts from. */
export interface BucketSearch {
  where: Record<string, string>
  /** The facts whose hidden values the URL asks for. */
  show?: string[]
  ref?: string
  from?: string
  to?: string
  cursor?: string
}

export type BucketListResult = ListResult<BucketResult | null>

const pageSize = 20

/** A first page asks for the groups; a later page is only its rows. */
const toQuery = (bucket: BucketEntry, search: BucketSearch): BucketQuery =>
  search.cursor
    ? { ...search, limit: pageSize }
    : { ...search, limit: pageSize, groupBy: bucket.groupings }

export const queryBucketUseCase = async (
  bucket: BucketEntry,
  search: BucketSearch,
  repeat: boolean
): Promise<BucketListResult> =>
  readList(
    `bucket ${bucket.id}`,
    () => queryBucket(bucket.id, toQuery(bucket, search), repeat),
    null
  )
