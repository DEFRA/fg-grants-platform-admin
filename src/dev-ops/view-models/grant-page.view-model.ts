import type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { grantTabs, offersTab } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { toUnavailableSources } from './event-row.ts'
import { toGrantPhases } from './grant-phases.view-model.ts'
import type { GrantPhasesTab } from './grant-phases.view-model.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import { toPaymentDefinition } from './payment-definition.ts'
import type { PaymentDefinitionView } from './payment-definition.ts'
import {
  toDateFact,
  toMonoFact,
  toRaw,
  toSizeFact,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RawTab, RecordPageModel } from './record-page.view-model.ts'
import type { RecordType } from './record-type.ts'
import { toVersionHeader } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'

export interface GrantPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** The file the tab needs, while it is not stored. */
  notStored: DefinitionFileType | null
  phases: GrantPhasesTab | null
  payment: { view: PaymentDefinitionView | null; raw: RawTab } | null
}

/** Query params the grant's tabs read. */
export interface GrantPageQuery {
  /** The selected status on Phases. */
  status?: string
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

const toOfferedGrantType = (header: GrantVersionHeader): RecordType => ({
  ...grantType,
  tabs: grantType.tabs.filter(({ id }) => offersTab(header, id as GrantTabId))
})

const toNotStored = (
  { files }: GrantVersionHeader,
  tab: GrantTabId
): DefinitionFileType | null => {
  const { file } = grantTabs[tab]

  return file && files[file]?.stored === false ? file : null
}

const toPaymentTab = ({
  payment,
  sectionErrors
}: GrantVersionPage): GrantPageModel['payment'] => ({
  view: payment ? toPaymentDefinition(payment) : null,
  raw: toRaw(payment, sectionErrors, 'payment')
})

export const toGrantPage = (
  page: GrantVersionPage,
  tab: GrantTabId,
  from: string,
  { query }: { query: GrantPageQuery }
): GrantPageModel => {
  const { read } = grantTabs[tab]
  const href = toGrantHref(page.header)

  return {
    record: grantType,
    ref: page.header.code,
    backHref: from,
    navActive: null,
    trail: [],
    tabs: toTabs(toOfferedGrantType(page.header), href, tab, from),
    tab,
    facts: page.overview ? toFacts(page.header, page.overview) : null,
    series: null,
    seriesDetailed: false,
    events: null,
    ...toTabSection(page.definition, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(grantType, page.header, tab, from),
    notStored: toNotStored(page.header, tab),
    phases:
      tab === 'phases'
        ? toGrantPhases(page, {
            status: query.status,
            href,
            from,
            workflowHref: null
          })
        : null,
    payment: tab === 'payment' ? toPaymentTab(page) : null
  }
}
