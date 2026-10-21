import type {
  WorkflowFileType,
  WorkflowVersionHeader,
  WorkflowVersionOverview,
  WorkflowVersionPage
} from '../use-cases/get-workflow-page.use-case.ts'
import { workflowTabs } from '../use-cases/workflow-tabs.ts'
import type { WorkflowTabId } from '../use-cases/workflow-tabs.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type {
  DefinitionFetchFlash,
  DefinitionFetchNotice
} from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import {
  toDateFact,
  toSizeFact,
  toTabSection,
  toTabs,
  toTextFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'
import { toVersionHeader, toVersionPath } from './version-header.ts'
import type { VersionHeader } from './version-header.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'
import type { WorkflowPagesTab } from './workflow-pages-tab.ts'
import { toWorkflowHref, workflowType } from './workflows-page.view-model.ts'

export interface WorkflowPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  /** The file the tab needs, while it is not stored. */
  notStored: WorkflowFileType | null
  pages: WorkflowPagesTab | null
}

const toFacts = (
  header: WorkflowVersionHeader,
  overview: WorkflowVersionOverview
): Fact[][] => [
  [
    toTextFact('scheme-name', 'Scheme name', overview.schemeName),
    toDateFact('received', 'Received', header.receivedAt)
  ],
  [toSizeFact(overview.storedBytes)]
]

const toNotStored = (
  { files }: WorkflowVersionHeader,
  tab: WorkflowTabId
): WorkflowFileType | null => {
  const { file } = workflowTabs[tab]

  return file && !files[file].stored ? file : null
}

const toPagesTab = ({
  definition
}: WorkflowVersionPage): WorkflowPagesTab | null =>
  definition ? toWorkflowPagesTab(definition) : null

export const toWorkflowPage = (
  page: WorkflowVersionPage,
  tab: WorkflowTabId,
  from: string,
  { notice }: { notice?: DefinitionFetchFlash } = {}
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
    facts: page.overview ? toFacts(page.header, page.overview) : null,
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
    notStored: toNotStored(page.header, tab),
    pages: tab === 'pages' ? toPagesTab(page) : null
  }
}
