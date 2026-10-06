import type {
  ApplicationPage,
  ApplicationRef
} from '../repositories/applications.repository.ts'
import type { RecordTab } from '../repositories/record-page.ts'
import { findApplicationPage } from '../repositories/applications.repository.ts'
import type { RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'

export type {
  ApplicationPage,
  ApplicationRef
} from '../repositories/applications.repository.ts'

export type ApplicationResult = RecordResult<ApplicationPage>

export const getApplicationPageUseCase = async (
  ref: ApplicationRef,
  tab: RecordTab
): Promise<ApplicationResult> =>
  readRecord(
    'application',
    () => findApplicationPage(ref, tab),
    'APPLICATION_NOT_FOUND'
  )
