import type {
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowVersionOverview,
  WorkflowVersionPage,
  WorkflowVersionRef
} from '../use-cases/get-workflow-page.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import { workflowTabs } from '../use-cases/workflow-tabs.ts'
import type { WorkflowTabId } from '../use-cases/workflow-tabs.ts'
import { toVersionListHref } from './bucket-links.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type {
  DefinitionFetchFlash,
  DefinitionFetchNotice
} from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import {
  toCodesFact,
  toDateFact,
  toLinkFact,
  toReleaseCounterpartFacts,
  toSizeFact,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import { toVersionHeader, toVersionPath } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface WorkflowPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  /** The file the tab needs, while it is not stored. */
  notStored: WorkflowFileType | null
}

const toCasesHref = (
  catalogue: Catalogue | null,
  { code, version }: WorkflowVersionRef
): string | null =>
  toVersionListHref(
    catalogue,
    'cw.cases',
    { codeFact: 'workflowCode', versionFact: 'currentConfigVersion' },
    { code, version }
  )

const noRoles = { allOf: null, anyOf: null }

const toRolesFacts = ({
  allOf,
  anyOf
}: Record<'allOf' | 'anyOf', string[] | null>): Fact[] => [
  toCodesFact('roles-all-of', 'Roles, all of', allOf),
  toCodesFact('roles-any-of', 'Roles, any of', anyOf)
]

const toFacts = (
  header: WorkflowVersionHeader,
  overview: WorkflowVersionOverview,
  casesHref: string | null
): Fact[][] => [
  [
    toTextFact('scheme-name', 'Scheme name', overview.schemeName),
    toDateFact('received', 'Received', header.receivedAt),
    ...toRolesFacts(overview.requiredRoles ?? noRoles)
  ],
  [
    ...toReleaseCounterpartFacts(
      grantType,
      header.counterpart,
      toGrantHref(header)
    ),
    toLinkFact('cases', 'Cases', 'View cases', casesHref),
    toTextFact('versions', 'Versions', String(header.versions.length)),
    toSizeFact(overview.storedBytes)
  ]
]

const toNotStored = (
  { files }: WorkflowVersionHeader,
  tab: WorkflowTabId
): WorkflowFileType | null => {
  const { file } = workflowTabs[tab]

  return file && !files[file].stored ? file : null
}

export const toWorkflowPage = (
  page: WorkflowVersionPage,
  tab: WorkflowTabId,
  from: string,
  {
    notice,
    catalogue
  }: { notice?: DefinitionFetchFlash; catalogue: Catalogue | null }
): WorkflowPageModel => {
  const { read } = workflowTabs[tab]

  return {
    record: workflowType,
    ref: page.header.code,
    backHref: from,
    navActive: null,
    trail: [],
    tabs: toTabs(workflowType, toWorkflowHref(page.header), tab, from),
    tab,
    facts: page.overview
      ? toFacts(page.header, page.overview, toCasesHref(catalogue, page.header))
      : null,
    series: null,
    seriesDetailed: false,
    events: null,
    ...toTabSection(page.raw, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(workflowType, page.header, tab, from),
    notices: toDefinitionFetchNotices(
      workflowType,
      notice,
      toVersionPath(workflowType, page.header)
    ),
    notStored: toNotStored(page.header, tab)
  }
}
