import type { EventRow } from './events.repository.ts'

// Shapes GAS uses alike for its lists and its application and case pages.

export interface Position {
  phase: string | null
  stage: string | null
  status: string | null
}

/** The phases of the definition the record's version names, in order, and its own stage and status by name. */
export interface PositionNames {
  phases: { code: string; name: string | null }[]
  stage: string | null
  status: string | null
}

export interface ListTotal {
  count: number
  capped: boolean
}

/** As stored: an ISO instant, or any other string GAS found there, empty included. */
export type StoredDate = string | null

/** Refs and members oldest first; a series of fewer than two has no members to show. */
export interface RecordSeries<Member> {
  latestRef: string | null
  refs: string[]
  members?: Member[]
}

export interface RecordEvents {
  rows: EventRow[]
  /** More matched than the newest each queue gives. */
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
