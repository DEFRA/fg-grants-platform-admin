import type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { grantTabs } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { toUnavailableSources } from './event-row.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import {
  toDateFact,
  toMonoFact,
  toSizeFact,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import { toVersionHeader } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'

export interface GrantPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** The file the tab needs, while it is not stored. */
  notStored: DefinitionFileType | null
}

const toFacts = (
  header: GrantVersionHeader,
  overview: GrantVersionOverview
): Fact[][] => [
  [
    toTextFact('description', 'Description', overview.description),
    toDateFact('start-date', 'Start date', overview.startDate),
    toDateFact('received', 'Received', header.receivedAt),
    toMonoFact('admin-role', 'Admin role', overview.adminRole)
  ],
  [toSizeFact(overview.storedBytes)]
]

const toNotStored = (
  { files }: GrantVersionHeader,
  tab: GrantTabId
): DefinitionFileType | null => {
  const { file } = grantTabs[tab]

  return file && files[file]?.stored === false ? file : null
}

export const toGrantPage = (
  page: GrantVersionPage,
  tab: GrantTabId,
  from: string
): GrantPageModel => {
  const { read } = grantTabs[tab]

  return {
    record: grantType,
    ref: page.header.code,
    backHref: from,
    navActive: null,
    trail: [],
    tabs: toTabs(grantType, toGrantHref(page.header), tab, from),
    tab,
    facts: page.overview ? toFacts(page.header, page.overview) : null,
    series: null,
    seriesDetailed: false,
    events: null,
    ...toTabSection(page.definition, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(grantType, page.header, tab, from),
    notStored: toNotStored(page.header, tab)
  }
}
