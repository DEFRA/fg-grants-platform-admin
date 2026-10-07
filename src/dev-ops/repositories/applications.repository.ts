import { getFromGas, postToGas } from '../../common/gas.ts'
import type { SourceError } from './events.repository.ts'
import type {
  Counterpart,
  ListPagination,
  ListTotal,
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from './record-page.ts'
import { toRepeatOptions } from './record-page.ts'

export type { ListPagination, ListTotal, Position } from './record-page.ts'

export interface ApplicationRef {
  clientRef: string
  code: string
}

export interface ApplicationRow {
  ref: ApplicationRef
  position: Position
  createdAt: StoredDate
  replaced: boolean
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

/** A POST, so a searched ref travels in the body and never in a logged URL. */
export const searchApplications = async (
  search: ApplicationsSearch,
  repeat: boolean
): Promise<ApplicationsPage> =>
  postToGas<ApplicationsPage>('/grant-admin/applications/search', {
    payload: search,
    ...toRepeatOptions(repeat)
  })

export interface ApplicationHeader {
  clientRef: string
  code: string
  position: Position
  counterpart: Counterpart
  fetchedAt: string
}

export interface ApplicationSeriesMember {
  clientRef: string
  position: Position
  createdAt: StoredDate
}

export interface ApplicationOverview {
  code: string
  originalConfigVersion: string | null
  currentConfigVersion: string | null
  submittedAt: StoredDate
  createdAt: StoredDate
  updatedAt: StoredDate
  identifiers: {
    sbi: string | null
    frn: string | null
    crn: string | null
  }
  series: RecordSeries<ApplicationSeriesMember> | null
  storedBytes: number | null
}

export interface ApplicationPage {
  header: ApplicationHeader
  overview?: ApplicationOverview | null
  events?: RecordEvents | null
  /** The stored document as stored: answers and metadata are never read here. */
  raw?: object | null
  storedBytes?: number | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export const findApplicationPage = async (
  { code, clientRef }: ApplicationRef,
  tab: RecordTab
): Promise<ApplicationPage> =>
  getFromGas<ApplicationPage>(
    `/grant-admin/grants/${encodeURIComponent(code)}/applications/${encodeURIComponent(clientRef)}/${tab}`
  )
