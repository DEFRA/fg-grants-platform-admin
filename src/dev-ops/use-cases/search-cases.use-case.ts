import type { CasesPage } from '../repositories/cases.repository.ts'
import { searchCases } from '../repositories/cases.repository.ts'
import type { ListResult, RecordListSearch } from './record-reads.ts'
import { emptyListPage, readList } from './record-reads.ts'

export type {
  CaseRow,
  CasesPage,
  CasesSearch
} from '../repositories/cases.repository.ts'

export type CasesResult = ListResult<CasesPage>

/** GAS reads the list from Caseworking alone, so Caseworking down is an empty list here. */
export const searchCasesUseCase = async (
  { code, ...search }: RecordListSearch,
  repeat: boolean
): Promise<CasesResult> =>
  readList(
    'cases',
    () =>
      searchCases(
        { ...search, ...(code ? { workflowCode: code } : {}) },
        repeat
      ),
    emptyListPage
  )
