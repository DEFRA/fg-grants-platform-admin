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
  EntitlementField,
  EntitlementTemplate,
  ExternalStatusMapping,
  GrantEntitlements,
  GrantLifecycle,
  GrantVersionHeader,
  GrantVersionPage,
  GrantVersionRef,
  HelpBlock,
  ProcessAddress,
  ProcessEffect,
  TemplatePosition,
  WayIn
} from '../repositories/grants.repository.ts'

export type GrantPage = GrantVersionPage

export type GrantPageResult = RecordResult<GrantPage> | HiddenTab

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

const readPage = (ref: GrantVersionRef, read: GrantRead) =>
  readRecord(
    'grant version',
    () => findTabPage(ref, read),
    'GRANT_VERSION_NOT_FOUND'
  )

/** Overview's answer carries the version's events. */
export const getGrantPageUseCase = async (
  ref: GrantVersionRef,
  tab: GrantTabId
): Promise<GrantPageResult> => {
  const { outcome, page, failure } = await readPage(ref, grantTabs[tab].read)

  if (page === null) {
    return outcome === 'found' ? hidden : { outcome, page, failure }
  }

  return offersTab(page.header, tab) ? { outcome, page } : hidden
}
