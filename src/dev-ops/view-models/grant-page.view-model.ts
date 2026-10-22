import type {
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { grantTabs, offersTab } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { toAdminHref } from '../../grant-ops/view-models/allow-list-page.view-model.ts'
import type { DefinitionFetchFlash } from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import { toGrantQuestions } from './grant-questions.ts'
import type { GrantQuestionsTab } from './grant-questions.ts'
import { toGrantActions } from './grant-actions.ts'
import type { GrantActionsTab } from './grant-actions.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type { AgreementTab } from './grant-agreement.view-model.ts'
import { toEntitlementsTab } from './grant-entitlements.ts'
import type { EntitlementsTab, PaymentFileState } from './grant-entitlements.ts'
import { toGrantPhases } from './grant-phases.view-model.ts'
import type { GrantPhasesTab } from './grant-phases.view-model.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import { toPaymentDefinition } from './payment-definition.ts'
import type { PaymentDefinitionView } from './payment-definition.ts'
import {
  toDateFact,
  toDayFact,
  toLinkFact,
  toMonoFact,
  toRaw,
  toReleaseCounterpartFacts,
  toSizeFact,
  toTabHref,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RawTab, RecordPageModel } from './record-page.view-model.ts'
import type { RecordType } from './record-type.ts'
import { toFileLines } from './version-banner.ts'
import { toNotStored, toVersionShell } from './version-page.ts'
import type { NotStored, VersionShell } from './version-page.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface GrantPageModel extends RecordPageModel, VersionShell {
  notStored: NotStored | null
  questions: GrantQuestionsTab | null
  actions: GrantActionsTab | null
  agreement: AgreementTab | null
  phases: GrantPhasesTab | null
  entitlements: EntitlementsTab | null
  payment: { view: PaymentDefinitionView | null; raw: RawTab } | null
}

/** Query params the grant's tabs read. */
export interface GrantPageQuery {
  /** The selected status on Phases. */
  status?: string
}

const toAllowListHref = (code: string): string =>
  `${toAdminHref(code)}#who-can-apply`

const toFacts = (
  header: GrantVersionHeader,
  overview: GrantVersionOverview,
  catalogue: Catalogue | null
): Fact[][] => [
  [
    toTextFact('description', 'Name', overview.description),
    toDayFact(
      'start-date',
      'Start date (metadata)',
      overview.startDate,
      'not used by GAS'
    ),
    toDateFact('received', 'Received', header.receivedAt),
    toMonoFact('admin-role', 'Admin role', overview.adminRole),
    {
      id: 'definitions',
      label: 'Definitions',
      kind: 'lines',
      lines: toFileLines(grantType, header, catalogue)
    }
  ],
  [
    ...toReleaseCounterpartFacts(
      workflowType,
      header.counterpart,
      toWorkflowHref(header)
    ),
    toLinkFact(
      'who-can-apply',
      'Who can apply',
      'Allow list',
      toAllowListHref(header.code)
    ),
    toTextFact('versions', 'Versions', String(header.versions.length)),
    toSizeFact(overview.storedBytes, 'Definition size')
  ]
]

const toOfferedGrantType = (header: GrantVersionHeader): RecordType => ({
  ...grantType,
  tabs: grantType.tabs.filter(({ id }) => offersTab(header, id as GrantTabId))
})

const toEntitlementsHrefs = (href: string, from: string) => ({
  phases: (status: string | null) =>
    toTabHref(href, 'phases', from, status === null ? {} : { status }),
  payment: toTabHref(href, 'payment', from)
})

/** Null unless CW has the workflow version, so a CW status never links to a page CW cannot show. */
const toWorkflowPhasesHref = (header: GrantVersionHeader) =>
  header.counterpart?.exists
    ? (cwStatus: string, back: string) =>
        toTabHref(toWorkflowHref(header), 'phases', back, { status: cwStatus })
    : null

const toPaymentFileState = ({
  files
}: GrantVersionHeader): PaymentFileState | null => {
  if (!files.payment) {
    return null
  }

  if (files.payment.fetchStatus === 'permanent_error') {
    return 'failed'
  }

  return files.payment.stored ? 'stored' : 'not-stored'
}

const toEntitlements = (
  { header, entitlements }: GrantVersionPage,
  tab: GrantTabId,
  href: string,
  from: string
): EntitlementsTab | null =>
  tab === 'entitlements' && entitlements
    ? toEntitlementsTab(
        {
          entitlements,
          payment: toPaymentFileState(header)
        },
        toEntitlementsHrefs(href, from)
      )
    : null

/** A tab's link, or null when the version has no file for that tab, so it is not offered. */
const toFileTabHref = (
  { files }: GrantVersionHeader,
  file: 'agreement' | 'payment',
  href: string,
  from: string
): string | null => (files[file] ? toTabHref(href, file, from) : null)

const toPaymentTab = (
  { header, payment, sectionErrors }: GrantVersionPage,
  tab: GrantTabId,
  href: string,
  from: string
): GrantPageModel['payment'] =>
  tab === 'payment'
    ? {
        view: payment
          ? toPaymentDefinition(payment, {
              version: header.version,
              hrefs: {
                entitlements: toTabHref(href, 'entitlements', from),
                agreement: toFileTabHref(header, 'agreement', href, from)
              }
            })
          : null,
        raw: toRaw(payment, sectionErrors, 'payment')
      }
    : null

const agreementFetchStatus = ({ files }: GrantVersionHeader) =>
  files.agreement?.fetchStatus ?? null

const toAgreement = (
  { header, agreement }: GrantVersionPage,
  tab: GrantTabId,
  href: string,
  from: string
): AgreementTab | null =>
  tab === 'agreement' && agreement
    ? toAgreementTab(agreement, {
        version: header.version,
        fetchStatus: agreementFetchStatus(header),
        hrefs: {
          phases: toTabHref(href, 'phases', from),
          payment: toFileTabHref(header, 'payment', href, from)
        }
      })
    : null

const toQuestions = (
  { definition }: GrantVersionPage,
  tab: GrantTabId
): GrantQuestionsTab | null =>
  tab === 'questions' && definition ? toGrantQuestions(definition) : null

const toActions = (
  { definition }: GrantVersionPage,
  tab: GrantTabId
): GrantActionsTab | null =>
  tab === 'actions' && definition ? toGrantActions(definition.actions) : null

const toPhases = (
  page: GrantVersionPage,
  tab: GrantTabId,
  { status }: GrantPageQuery,
  href: string,
  from: string
): GrantPhasesTab | null =>
  tab === 'phases'
    ? toGrantPhases(page, {
        status,
        href,
        from,
        workflowHref: toWorkflowPhasesHref(page.header)
      })
    : null

const toOverviewFacts = (
  { header, overview }: GrantVersionPage,
  catalogue: Catalogue | null
): Fact[][] | null => (overview ? toFacts(header, overview, catalogue) : null)

export const toGrantPage = (
  page: GrantVersionPage,
  tab: GrantTabId,
  from: string,
  {
    notice,
    query,
    catalogue
  }: {
    notice?: DefinitionFetchFlash
    query: GrantPageQuery
    catalogue: Catalogue | null
  },
  now: Date = new Date()
): GrantPageModel => {
  const href = toGrantHref(page.header)
  const { read } = grantTabs[tab]

  return {
    record: grantType,
    ref: page.header.code,
    trail: [],
    tabs: toTabs(toOfferedGrantType(page.header), href, tab, from),
    tab,
    facts: toOverviewFacts(page, catalogue),
    series: null,
    seriesDetailed: false,
    events: null,
    ...toTabSection(page.definition, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    ...toVersionShell(grantType, page.header, tab, from, {
      notice,
      catalogue,
      now
    }),
    notStored: toNotStored(page.header, tab, grantTabs[tab].file),
    phases: toPhases(page, tab, query, href, from),
    questions: toQuestions(page, tab),
    actions: toActions(page, tab),
    entitlements: toEntitlements(page, tab, href, from),
    agreement: toAgreement(page, tab, href, from),
    payment: toPaymentTab(page, tab, href, from)
  }
}
