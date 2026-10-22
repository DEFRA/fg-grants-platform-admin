import type {
  GrantRead,
  GrantVersionPage,
  GrantVersionRef
} from '../repositories/grants.repository.ts'
import { findGrantVersionPage } from '../repositories/grants.repository.ts'
import { grantTabs, offersTab } from './grant-tabs.ts'
import type { GrantTabId } from './grant-tabs.ts'
import type { HiddenTab, RecordResult } from './record-reads.ts'
import { isMissing, readRecord } from './record-reads.ts'

export type {
  AgreementDefinition,
  DefinitionFileType,
  GrantDefinition,
  GrantAgreement,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage,
  GrantVersionRef,
  ProcessAddress
} from '../repositories/grants.repository.ts'

export type GrantPageResult = RecordResult<GrantVersionPage> | HiddenTab

const hidden: HiddenTab = { outcome: 'hidden', page: null }

/** Null when GAS refuses the tab because the version has no file for it. */
const findTabPage = async (
  ref: GrantVersionRef,
  read: GrantRead
): Promise<GrantVersionPage | null> => {
  try {
    return await findGrantVersionPage(ref, read)
  } catch (error) {
    if (isMissing(error, 'NO_DEFINITION_FILE')) {
      return null
    }

    throw error
  }
}

export const getGrantPageUseCase = async (
  ref: GrantVersionRef,
  tab: GrantTabId
): Promise<GrantPageResult> => {
  const { read } = grantTabs[tab]
  const { outcome, page } = await readRecord(
    'grant version',
    () => findTabPage(ref, read),
    'GRANT_VERSION_NOT_FOUND'
  )

  if (page === null) {
    return outcome === 'found' ? hidden : { outcome, page }
  }

  return offersTab(page.header, tab) ? { outcome, page } : hidden
}
