import type { ApplicationsPage } from '../repositories/applications.repository.ts'
import { searchApplications } from '../repositories/applications.repository.ts'
import type { ListResult, RecordListSearch } from './record-reads.ts'
import { emptyListPage, readList } from './record-reads.ts'

export type {
  ApplicationRow,
  ApplicationsPage,
  ApplicationsSearch,
  ListTotal
} from '../repositories/applications.repository.ts'

export type ApplicationsResult = ListResult<ApplicationsPage>

export const searchApplicationsUseCase = async (
  search: RecordListSearch,
  repeat: boolean
): Promise<ApplicationsResult> =>
  readList(
    'applications',
    () => searchApplications(search, repeat),
    emptyListPage
  )
