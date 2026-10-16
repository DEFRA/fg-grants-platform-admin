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

export type { Position } from './record-page.ts'

export interface ApplicationRef {
  clientRef: string
  code: string
}

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
