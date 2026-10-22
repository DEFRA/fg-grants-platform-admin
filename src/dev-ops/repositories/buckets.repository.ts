import { getFromGas, postToGas } from '../../common/gas.ts'
import type { BadgeRole, SourceError } from './events.repository.ts'
import type { ListTotal, Position } from './record-page.ts'
import { toRepeatOptions } from './record-page.ts'

export type FactValue = string

export interface BucketFactValue {
  value: FactValue
  label: string
  tone?: BadgeRole
  /** Left out of the list until the fact's toggle is switched on. */
  hidden?: boolean
}

/** A fact with hidden values, drawn with a switch that shows them. */
export interface BucketToggle {
  label: string
  /** Its key in this admin's URLs, set to `on` while it is. */
  param: string
}

export interface BucketFact {
  name: string
  /** Its key in this admin's URLs. */
  param: string
  label: string
  /** Null for an open fact: one with no list to choose from. */
  values: BucketFactValue[] | null
  toggle: BucketToggle | null
  /** The fact this one is scoped to, as a version is to its grant; choosing that fact clears this one. */
  within: string | null
}

export interface BucketRefKind {
  kind: string
  label: string
}

export interface BucketColumn {
  key: string
  label: string
  format: string
  /** On a `badge` column only: the fact whose values label and colour it. */
  fact?: string
}

/** A ranked count a list declares: the values of `by` among the rows `among` picks out. */
export interface BucketSummary {
  id: string
  label: string
  /** The facts each entry is one combination of, in the order they are drawn. */
  by: string[]
  among: Record<string, string>
  top: number
  /** What the rows that hold no value are called. */
  none: string
}

/** A page several lists of one service share, each as a tab of it. */
export interface BucketPage {
  id: string
  label: string
  /** The label less the service, for where the service is already said. */
  shortLabel: string
}

/** One list, as the service that owns it declares it. */
export interface BucketEntry {
  id: string
  /** Where its list is drawn, below this admin's root, as `events/gas/outbox`. */
  path: string
  label: string
  /** The owning service, by the name the navigation heads its lists with. */
  service: string
  /** The label less the service, for where the service is already said. */
  shortLabel: string
  /** The icon its link is drawn with; null for a list that declares none. */
  icon: string | null
  order: number
  noun: { one: string; many: string }
  time: { label: string }
  facts: BucketFact[]
  refs: BucketRefKind[]
  indexes: string[][]
  groupings: string[]
  title: { label: string; format: string }
  columns: BucketColumn[]
  audited: boolean
  timeline: boolean
  summaries: BucketSummary[]
  /** The page it is a tab of, and its label there; null for a list with a page of its own. */
  page: BucketPage | null
  tab: string | null
}

export interface Catalogue {
  buckets: BucketEntry[]
  sourceErrors: SourceError[]
}

export interface BucketQuery {
  where?: Record<string, string>
  /** The facts whose hidden values are asked for. */
  show?: string[]
  /** One `kind:value`. */
  ref?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
  groupBy?: string[]
}

export interface BucketPlan {
  kind: string
  index: string[]
  bound: string[]
  filled: string[]
  residual: string[]
  scans: number
}

export type BucketCell = string | number | boolean | Position | null

export interface BucketLink {
  kind: string
  [key: string]: unknown
}

export interface BucketRow {
  id: string
  time: string
  title: string | null
  subtitle: string | null
  cells: Record<string, BucketCell>
  link: BucketLink | null
}

export interface BucketPaging {
  next: string | null
  /** Set when a bounded read stopped at its scan budget: where the next one starts. */
  keepLooking: string | null
  searchedTo: string | null
  complete: boolean
}

export interface BucketGroupValue {
  value: FactValue
  count: number
  capped: boolean
}

export interface BucketGroup {
  by: string
  /** Null when the counts could not be read exactly. */
  values: BucketGroupValue[] | null
  /** The list with this fact's own filter left out; null when it could not be counted exactly. */
  total: ListTotal | null
}

export interface BucketResult {
  bucket: string
  plan: BucketPlan
  rows: BucketRow[]
  page: BucketPaging
  groups: BucketGroup[]
}

export interface SummaryEntry {
  /** One value per `by` fact; null for the rows that hold none. */
  values: Record<string, FactValue | null>
  count: number
  capped: boolean
  firstAt: string | null
  lastAt: string | null
}

export interface SummaryResult {
  bucket: string
  summary: string
  entries: SummaryEntry[]
  /** Entries were left off the end. */
  more: boolean
  /** False when there were more distinct values than are counted. */
  complete: boolean
}

export interface SummaryQuery {
  /** The facts whose hidden values are counted too. */
  show?: string[]
  from?: string
  to?: string
}

export const findBuckets = async (): Promise<Catalogue> =>
  getFromGas<Catalogue>('/grant-admin/buckets')

/** A POST, so a searched ref travels in the body and never in a logged URL. */
export const queryBucket = async (
  bucketId: string,
  query: BucketQuery,
  repeat: boolean
): Promise<BucketResult> =>
  postToGas<BucketResult>(
    `/grant-admin/buckets/${encodeURIComponent(bucketId)}/query`,
    { payload: query, ...toRepeatOptions(repeat) }
  )

export const summariseBucket = async (
  bucketId: string,
  summaryId: string,
  query: SummaryQuery
): Promise<SummaryResult> =>
  postToGas<SummaryResult>(
    `/grant-admin/buckets/${encodeURIComponent(bucketId)}/summaries/${encodeURIComponent(summaryId)}`,
    { payload: query }
  )
