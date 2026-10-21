import type {
  GrantVersionPage,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import { grantTabs } from './grant-tabs.ts'
import type { GrantTabId } from './grant-tabs.ts'
import type { HiddenTab, RecordResult } from './record-reads.ts'
import { readRecord } from './record-reads.ts'

export type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage,
  GrantVersionRef,
  GrantVersionSummary
} from '../repositories/grants.repository.ts'

export type GrantPageResult = RecordResult<GrantVersionPage> | HiddenTab

export const getGrantPageUseCase = async (
  ref: GrantVersionRef,
  tab: GrantTabId
): Promise<GrantPageResult> => {
  const { read, file } = grantTabs[tab]
  const result = await readRecord(
    'grant version',
    () => findGrantVersionPage(ref, read),
    'GRANT_VERSION_NOT_FOUND'
  )

  return file && result.page && !result.page.header.files[file]
    ? { outcome: 'hidden', page: null }
    : result
}
