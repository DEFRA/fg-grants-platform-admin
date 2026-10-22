import type {
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowPage,
  WorkflowVersionOverview,
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
  toEvents,
  toSizeFact,
  toTabHref,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import { toVersionHeader, toVersionPath } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'
import { toWorkflowIntegrations } from './workflow-integrations.ts'
import type { WorkflowIntegrations } from './workflow-integrations.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'
import type { WorkflowPagesTab } from './workflow-pages-tab.ts'
import { toWorkflowPhases } from './workflow-phases.view-model.ts'
import type { WorkflowPhasesTab } from './workflow-phases.view-model.ts'
import { toTaskGroups } from './workflow-tasks.view-model.ts'
import type { TaskGroupCard } from './workflow-tasks.view-model.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface WorkflowPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  /** The file the tab needs, while it is not stored. */
  notStored: WorkflowFileType | null
  phases: WorkflowPhasesTab | null
  taskGroups: TaskGroupCard[] | null
  pages: WorkflowPagesTab | null
  integrations: WorkflowIntegrations | null
}

/** Query params the workflow's tabs read. */
export interface WorkflowPageQuery {
  /** The selected status on Phases: a full position or a bare CW code. */
  status?: string
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

const toTasksTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId
): TaskGroupCard[] | null =>
  tab === 'tasks' && definition
    ? toTaskGroups(definition.workflow.phases)
    : null

const toPagesTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId,
  integrationsHref: string
): WorkflowPagesTab | null =>
  tab === 'pages' && definition
    ? toWorkflowPagesTab(definition, integrationsHref)
    : null

const toIntegrationsTab = (
  { definition }: WorkflowPage,
  tab: WorkflowTabId,
  pagesHref: string
): WorkflowIntegrations | null =>
  tab === 'integrations' && definition
    ? toWorkflowIntegrations(definition, pagesHref)
    : null

/**
 * The grant link comes back to this tab without its own `back`, so links
 * followed back and forth never nest one `back` inside another.
 */
const toPhasesTab = (
  { header, definition, grantStatusMap }: WorkflowPage,
  from: string,
  { status }: WorkflowPageQuery
): WorkflowPhasesTab | null => {
  const href = toWorkflowHref(header)
  const self = toTabHref(href, 'phases', '', status ? { status } : {})

  return definition && grantStatusMap
    ? toWorkflowPhases(definition.workflow.phases, grantStatusMap, status, {
        status: (position) =>
          toTabHref(href, 'phases', from, { status: position }),
        grantStatus: (position) =>
          toTabHref(toGrantHref(header), 'phases', self, { status: position })
      })
    : null
}

const toOverviewFacts = (
  { header, overview }: WorkflowPage,
  catalogue: Catalogue | null
): Fact[][] | null =>
  overview ? toFacts(header, overview, toCasesHref(catalogue, header)) : null

export const toWorkflowPage = (
  page: WorkflowPage,
  tab: WorkflowTabId,
  from: string,
  {
    notice,
    query,
    catalogue
  }: {
    notice?: DefinitionFetchFlash
    query: WorkflowPageQuery
    catalogue: Catalogue | null
  },
  now: Date = new Date()
): WorkflowPageModel => {
  const href = toWorkflowHref(page.header)
  const { read } = workflowTabs[tab]

  return {
    record: workflowType,
    ref: page.header.code,
    backHref: from,
    navActive: null,
    trail: [],
    tabs: toTabs(workflowType, href, tab, from),
    tab,
    facts: toOverviewFacts(page, catalogue),
    series: null,
    seriesDetailed: false,
    events: toEvents(page.events, now, toTabHref(href, 'events', from)),
    ...toTabSection(page.raw, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(workflowType, page.header, tab, from),
    notices: toDefinitionFetchNotices(
      workflowType,
      notice,
      toVersionPath(workflowType, page.header)
    ),
    notStored: toNotStored(page.header, tab),
    phases: tab === 'phases' ? toPhasesTab(page, from, query) : null,
    taskGroups: toTasksTab(page, tab),
    pages: toPagesTab(page, tab, toTabHref(href, 'integrations', from)),
    integrations: toIntegrationsTab(page, tab, toTabHref(href, 'pages', from))
  }
}
