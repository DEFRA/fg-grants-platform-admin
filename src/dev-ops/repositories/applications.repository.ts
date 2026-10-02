import { getFromGas, postToGas } from '../../common/gas.ts'
import type { EventRow, SourceError } from './events.repository.ts'

export interface Position {
  phase: string | null
  stage: string | null
  status: string | null
}

export interface ApplicationRef {
  clientRef: string
  code: string
}

export interface ApplicationRow {
  ref: ApplicationRef
  position: Position
  createdAt: string | null
  replaced: boolean
}

export interface ListPagination {
  endCursor: string | null
  hasNextPage: boolean
}

export interface ListTotal {
  count: number
  capped: boolean
}

export interface ApplicationsPage {
  rows: ApplicationRow[]
  pagination: ListPagination
  /** A first page only: a later page keeps the first page's. */
  total?: ListTotal
  /** The Grant menu, on a first page only. */
  codes?: string[]
  sourceErrors: SourceError[]
}

/** No `range`: the preset key stays in GPA's own URL. */
export interface ApplicationsSearch {
  ref?: string
  code?: string
  from?: string
  to?: string
  cursor?: string
}

/**
 * A POST, so a searched ref travels in the body and never in a logged URL.
 * `repeat` marks a Back or a refresh re-running a search already shown.
 */
export const searchApplications = async (
  search: ApplicationsSearch,
  repeat: boolean
): Promise<ApplicationsPage> =>
  postToGas<ApplicationsPage>('/grant-admin/applications/search', {
    payload: search,
    ...(repeat ? { headers: { 'x-search-repeat': '1' } } : {})
  })

export const applicationTabs = ['overview', 'events', 'raw'] as const

export type ApplicationTab = (typeof applicationTabs)[number]

/** GAS's name for its check of the case, in `sourceErrors` when it could not be made. */
export const caseCheckHop = 'CW-BE Cases'

export interface ApplicationHeader {
  clientRef: string
  code: string
  position: Position
  /** Null while the case link is unknown. */
  counterpart: { exists: boolean } | null
  fetchedAt: string
}

export interface ApplicationSeries {
  latestRef: string | null
  refs: string[]
}

export interface ApplicationOverview {
  code: string
  originalConfigVersion: string | null
  currentConfigVersion: string | null
  submittedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  identifiers: {
    sbi: string | null
    frn: string | null
    crn: string | null
  }
  series: ApplicationSeries | null
  storedBytes: number | null
}

export interface ApplicationEvents {
  rows: EventRow[]
  /** More than one page matched: the rest are on the events search. */
  more: boolean
}

export interface RecordSectionError {
  section: string
  message: string
}

export interface ApplicationPage {
  header: ApplicationHeader
  overview?: ApplicationOverview | null
  events?: ApplicationEvents | null
  /** The stored document as stored: answers and metadata are never read here. */
  raw?: object | null
  storedBytes?: number | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export const findApplicationPage = async (
  { code, clientRef }: ApplicationRef,
  tab: ApplicationTab
): Promise<ApplicationPage> =>
  getFromGas<ApplicationPage>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/${tab}`
  )
