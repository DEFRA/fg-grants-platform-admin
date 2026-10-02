import type {
  ApplicationsPage,
  ApplicationsSearch
} from '../repositories/applications.repository.ts'
import { searchApplications } from '../repositories/applications.repository.ts'
import type { ListResult } from './record-reads.ts'
import { readList } from './record-reads.ts'

export type {
  ApplicationRow,
  ApplicationsPage,
  ApplicationsSearch,
  ListTotal
} from '../repositories/applications.repository.ts'

export type ApplicationsResult = ListResult<ApplicationsPage>

const noPage: ApplicationsPage = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: []
}

export const searchApplicationsUseCase = async (
  search: ApplicationsSearch,
  repeat: boolean
): Promise<ApplicationsResult> =>
  readList('applications', () => searchApplications(search, repeat), noPage)
