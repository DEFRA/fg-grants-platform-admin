import { postToGas } from '../../common/gas.ts'
import type { BucketResult } from './buckets.repository.ts'
import type { Shell } from './shell.repository.ts'

/** A list by its admin path and its URL's fact params, as typed: GAS finds the entry and checks the address. */
export interface ListQuery {
  /** The catalogue entry's `path`, as `events/gas`. */
  path: string
  params: Record<string, string | string[]>
  /** The stored `kind:value`; null for a browse. */
  search: string | null
  from?: string
  to?: string
  cursor?: string
  /** Pages 1 to this, read in turn. */
  pages?: number
  /** Asks for the list's total, on its first page. */
  count?: boolean
  /** The last first page shown was this one. */
  repeat?: boolean
  /** False checks the address and reads no rows. */
  read?: boolean
}

/** A later page that couldn't be read, by its cursor: the rows before it stand. */
export interface ListStopped {
  cursor: string
  statusCode: number
  code: string | null
  /** The queue whose read failed it, of a list over several. */
  queue?: string
}

export interface ListPages extends BucketResult {
  /** Rows on each page read. */
  pageRows: number[]
  stopped: ListStopped | null
  /** GAS refused the search, so the rows are the list's first page without it. */
  refusedSearch: { refusal: string | null } | null
}

export interface ListAnswer {
  shell: Shell | null
  /** The entry's id, found in the shell's catalogue. */
  bucket: string
  /** Null when nothing was asked to be read. */
  list: ListPages | null
}

/** A POST, so a searched ref travels in the body and never in a logged URL. */
export const queryList = async (ask: ListQuery): Promise<ListAnswer> =>
  postToGas<ListAnswer>('/grant-admin/lists/query', { payload: ask })
