import type { EventRow } from './events.repository.ts'

// Shapes GAS uses alike for its Applications and Cases lists and pages.

export interface Position {
  phase: string | null
  stage: string | null
  status: string | null
}

export interface ListPagination {
  endCursor: string | null
  hasNextPage: boolean
}

export interface ListTotal {
  count: number
  capped: boolean
}

export interface RecordSeries {
  latestRef: string | null
  refs: string[]
}

export interface RecordEvents {
  rows: EventRow[]
  /** More than one page matched: the rest are on the events search. */
  more: boolean
}

export interface RecordSectionError {
  section: string
  message: string
}

export const recordTabs = ['overview', 'events', 'raw'] as const

export type RecordTab = (typeof recordTabs)[number]

/** Null while the other service could not say whether the counterpart exists. */
export type Counterpart = { exists: boolean } | null

/** Marks a Back or a refresh re-running a search already shown, so GAS audits it as a repeat. */
export const toRepeatOptions = (repeat: boolean) =>
  repeat ? { headers: { 'x-search-repeat': '1' } } : {}
