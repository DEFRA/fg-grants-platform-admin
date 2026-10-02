import type {
  CasesPage,
  CasesSearch
} from '../repositories/cases.repository.ts'
import { searchCases } from '../repositories/cases.repository.ts'
import type { ListResult } from './record-reads.ts'
import { readList } from './record-reads.ts'

export type {
  CaseRow,
  CasesPage,
  CasesSearch
} from '../repositories/cases.repository.ts'

export type CasesResult = ListResult<CasesPage>

const noPage: CasesPage = {
  rows: [],
  pagination: { endCursor: null, hasNextPage: false },
  sourceErrors: []
}

/** GAS reads the list from Caseworking alone, so Caseworking down is an empty list here. */
export const searchCasesUseCase = async (
  search: CasesSearch,
  repeat: boolean
): Promise<CasesResult> =>
  readList('cases', () => searchCases(search, repeat), noPage)
