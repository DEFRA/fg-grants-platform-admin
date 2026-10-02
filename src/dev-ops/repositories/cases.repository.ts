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
  RecordTab
} from './record-page.ts'
import { toRepeatOptions } from './record-page.ts'

export interface CaseRef {
  caseRef: string
  workflowCode: string
}

export interface CaseRow {
  ref: CaseRef
  position: Position
  closed: boolean | null
  closedAt: string | null
  createdAt: string | null
}

export interface CasesPage {
  rows: CaseRow[]
  pagination: ListPagination
  /** A first page only: a later page keeps the first page's. */
  total?: ListTotal
  /** The Workflow menu, on a first page only. */
  workflowCodes?: string[]
  sourceErrors: SourceError[]
}

/** No `range`: the preset key stays in GPA's own URL. */
export interface CasesSearch {
  ref?: string
  workflowCode?: string
  from?: string
  to?: string
  cursor?: string
}

/** A POST, so a searched ref travels in the body and never in a logged URL. */
export const searchCases = async (
  search: CasesSearch,
  repeat: boolean
): Promise<CasesPage> =>
  postToGas<CasesPage>('/grant-admin/cases/search', {
    payload: search,
    ...toRepeatOptions(repeat)
  })

/** GAS's name for its check of the application, in `sourceErrors` when it could not be made. */
export const applicationCheckHop = 'GAS Applications'

export interface CaseHeader {
  caseRef: string
  workflowCode: string
  position: Position
  closed: boolean | null
  closedAt: string | null
  counterpart: Counterpart
  fetchedAt: string
}

export interface CaseOverview {
  workflowCode: string
  originalConfigVersion: string | null
  currentConfigVersion: string | null
  createdAt: string | null
  closed: boolean | null
  closedAt: string | null
  series: RecordSeries | null
  storedBytes: number | null
}

export interface CasePage {
  header: CaseHeader
  overview?: CaseOverview | null
  events?: RecordEvents | null
  /** The stored case, less its caseworker notes, which never leave Caseworking. */
  raw?: object | null
  storedBytes?: number | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export const findCasePage = async (
  { workflowCode, caseRef }: CaseRef,
  tab: RecordTab
): Promise<CasePage> =>
  getFromGas<CasePage>(
    `/grant-admin/workflows/${encodeURIComponent(workflowCode)}/cases/${encodeURIComponent(caseRef)}/${tab}`
  )
