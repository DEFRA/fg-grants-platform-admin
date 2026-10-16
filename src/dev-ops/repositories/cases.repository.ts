import { getFromGas } from '../../common/gas.ts'
import type { SourceError } from './events.repository.ts'
import type {
  Counterpart,
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from './record-page.ts'

export interface CaseRef {
  caseRef: string
  workflowCode: string
}

export interface CaseHeader {
  caseRef: string
  workflowCode: string
  position: Position
  closed: boolean | null
  closedAt: StoredDate
  counterpart: Counterpart
  fetchedAt: string
}

/** CW's names, passed through by GAS. */
export interface CaseSeriesMember {
  caseRef: string
  position: Position
  createdAt: StoredDate
  closedAt: StoredDate
}

export interface CaseOverview {
  workflowCode: string
  originalConfigVersion: string | null
  currentConfigVersion: string | null
  createdAt: StoredDate
  closed: boolean | null
  closedAt: StoredDate
  series: RecordSeries<CaseSeriesMember> | null
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
