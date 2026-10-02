import type { CaseRef } from '../repositories/cases.repository.ts'
import type {
  CaseRow,
  CasesResult
} from '../use-cases/search-cases.use-case.ts'
import { toRecordList } from './record-list.view-model.ts'
import type {
  RecordListEntry,
  RecordListModel,
  RecordListQuery
} from './record-list.view-model.ts'
import type { RecordType } from './record-type.ts'

export const casesPath = '/dev-ops/cases'

export const caseType: RecordType = {
  listId: 'cases',
  itemId: 'case',
  title: 'Case',
  path: casesPath,
  noun: { one: 'case', many: 'cases' },
  codeName: 'Workflow',
  source: 'CW',
  showClosed: true,
  linkLabel: 'View case',
  counterpartLabel: 'View application',
  counterpartCheck: null
}

export const toCaseHref = ({ workflowCode, caseRef }: CaseRef): string =>
  `${casesPath}/${encodeURIComponent(workflowCode)}/${encodeURIComponent(caseRef)}`

const toEntry = (row: CaseRow): RecordListEntry => ({
  href: toCaseHref(row.ref),
  ref: row.ref.caseRef,
  code: row.ref.workflowCode,
  position: row.position,
  createdAt: row.createdAt,
  replaced: false,
  closedAt: row.closedAt
})

export const toCasesPage = (
  { page, ...result }: CasesResult,
  query: RecordListQuery,
  search: { q: string } | null,
  now: Date = new Date()
): RecordListModel =>
  toRecordList(
    caseType,
    {
      ...result,
      page: {
        ...page,
        entries: page.rows.map(toEntry),
        codes: page.workflowCodes
      }
    },
    query,
    search,
    now
  )
