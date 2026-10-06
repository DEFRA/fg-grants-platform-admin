import type { CasePage, CaseRef } from '../repositories/cases.repository.ts'
import { findCasePage } from '../repositories/cases.repository.ts'
import type { RecordTab } from '../repositories/record-page.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'

export type { CasePage, CaseRef } from '../repositories/cases.repository.ts'

export type CaseResult = RecordResult<CasePage>

export const getCasePageUseCase = async (
  ref: CaseRef,
  tab: RecordTab
): Promise<CaseResult> =>
  readRecord('case', () => findCasePage(ref, tab), 'CASE_NOT_FOUND')
