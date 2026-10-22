import type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage,
  GrantVersionRef
} from '../use-cases/get-grant-page.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { grantTabs, offersTab } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { toAdminHref } from '../../grant-ops/view-models/allow-list-page.view-model.ts'
import { toVersionListHref } from './bucket-links.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type {
  DefinitionFetchFlash,
  DefinitionFetchNotice
} from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import { toGrantQuestions } from './grant-questions.ts'
import type { GrantQuestionsTab } from './grant-questions.ts'
import { toGrantActions } from './grant-actions.ts'
import type { GrantActionRow } from './grant-actions.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type { AgreementTab } from './grant-agreement.view-model.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import { toPaymentDefinition } from './payment-definition.ts'
import type { PaymentDefinitionView } from './payment-definition.ts'
import {
  toDateFact,
  toEvents,
  toLinkFact,
  toMonoFact,
  toReleaseCounterpartFacts,
  toRaw,
  toSizeFact,
  toTabHref,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RawTab, RecordPageModel } from './record-page.view-model.ts'
import type { RecordType } from './record-type.ts'
import { toVersionHeader, toVersionPath } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface GrantPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  /** The file the tab needs, while it is not stored. */
  notStored: DefinitionFileType | null
  questions: GrantQuestionsTab | null
  actions: GrantActionRow[] | null
  agreement: AgreementTab | null
  payment: { view: PaymentDefinitionView | null; raw: RawTab } | null
}

const toAllowListHref = (code: string): string =>
  `${toAdminHref(code)}#who-can-apply`

const applicationsBucket = 'gas.applications'

const toApplicationsHref = (
  catalogue: Catalogue | null,
  { code, version }: GrantVersionRef
): string | null =>
  toVersionListHref(
    catalogue,
    applicationsBucket,
    { codeFact: 'code', versionFact: 'currentConfigVersion' },
    { code, version }
  )

const toFacts = (
  header: GrantVersionHeader,
  overview: GrantVersionOverview,
  applicationsHref: string | null
): Fact[][] => [
  [
    toTextFact('description', 'Description', overview.description),
    toDateFact('start-date', 'Start date', overview.startDate),
    toDateFact('received', 'Received', header.receivedAt),
    toMonoFact('admin-role', 'Admin role', overview.adminRole)
  ],
  [
    ...toReleaseCounterpartFacts(
      workflowType,
      header.counterpart,
      toWorkflowHref(header)
    ),
    toLinkFact(
      'applications',
      'Applications',
      'View applications',
      applicationsHref
    ),
    toLinkFact(
      'who-can-apply',
      'Who can apply',
      'Allow list',
      toAllowListHref(header.code)
    ),
    toTextFact('versions', 'Versions', String(header.versions.length)),
    toSizeFact(overview.storedBytes)
  ]
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

const toAgreement = (
  { agreement }: GrantVersionPage,
  tab: GrantTabId
): AgreementTab | null =>
  tab === 'agreement' && agreement ? toAgreementTab(agreement) : null

export const toGrantPage = (
  page: GrantVersionPage,
  tab: GrantTabId,
  from: string,
  {
    notice,
    catalogue
  }: { notice?: DefinitionFetchFlash; catalogue: Catalogue | null },
  now: Date = new Date()
): GrantPageModel => {
  const href = toGrantHref(page.header)
  const { read } = grantTabs[tab]

  return {
    record: grantType,
    ref: page.header.code,
    backHref: from,
    navActive: null,
    trail: [],
    tabs: toTabs(toOfferedGrantType(page.header), href, tab, from),
    tab,
    facts: page.overview
      ? toFacts(
          page.header,
          page.overview,
          toApplicationsHref(catalogue, page.header)
        )
      : null,
    series: null,
    seriesDetailed: false,
    events: toEvents(page.events, now, toTabHref(href, 'events', from)),
    ...toTabSection(page.definition, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(grantType, page.header, tab, from),
    notices: toDefinitionFetchNotices(
      grantType,
      notice,
      toVersionPath(grantType, page.header)
    ),
    notStored: toNotStored(page.header, tab),
    questions:
      tab === 'questions' && page.definition
        ? toGrantQuestions(page.definition)
        : null,
    actions:
      tab === 'actions' && page.definition
        ? toGrantActions(page.definition.actions)
        : null,
    agreement: toAgreement(page, tab),
    payment: tab === 'payment' ? toPaymentTab(page) : null
  }
}
