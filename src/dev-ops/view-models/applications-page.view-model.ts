import type { ApplicationRef } from '../repositories/applications.repository.ts'
import type {
  ApplicationRow,
  ApplicationsResult
} from '../use-cases/search-applications.use-case.ts'
import { caseCheckHop } from '../repositories/applications.repository.ts'
import { toRecordList } from './record-list.view-model.ts'
import type {
  RecordListEntry,
  RecordListModel,
  RecordListQuery
} from './record-list.view-model.ts'
import type { RecordType } from './record-type.ts'

export const applicationsPath = '/dev-ops/applications'

export const applicationType: RecordType = {
  id: 'applications',
  item: 'application',
  title: 'Application',
  path: applicationsPath,
  noun: { one: 'application', many: 'applications' },
  codeName: 'Grant',
  source: 'GAS',
  showClosed: false,
  counterpart: 'View case',
  counterpartHop: caseCheckHop,
  counterpartUnknown: 'CW unavailable. Case link unknown.'
}

export const toApplicationHref = ({
  code,
  clientRef
}: ApplicationRef): string =>
  `${applicationsPath}/${encodeURIComponent(code)}/${encodeURIComponent(clientRef)}`

const toEntry = (row: ApplicationRow): RecordListEntry => ({
  href: toApplicationHref(row.ref),
  ref: row.ref.clientRef,
  code: row.ref.code,
  position: row.position,
  createdAt: row.createdAt,
  replaced: row.replaced,
  closedAt: null
})

export const toApplicationsPage = (
  { page, ...result }: ApplicationsResult,
  query: RecordListQuery,
  search: { q: string } | null,
  now: Date = new Date()
): RecordListModel =>
  toRecordList(
    applicationType,
    {
      ...result,
      page: { ...page, entries: page.rows.map(toEntry), codes: page.codes }
    },
    query,
    search,
    now
  )
