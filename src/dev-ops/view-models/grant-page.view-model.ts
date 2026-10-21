import type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionOverview,
  GrantVersionPage,
  GrantVersionRef
} from '../use-cases/get-grant-page.use-case.ts'
import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import { grantTabs } from '../use-cases/grant-tabs.ts'
import type { GrantTabId } from '../use-cases/grant-tabs.ts'
import { toAdminHref } from '../../grant-ops/view-models/allow-list-page.view-model.ts'
import { toBucketHref } from './bucket-links.ts'
import { toDefinitionFetchNotices } from './definition-fetch.ts'
import type {
  DefinitionFetchFlash,
  DefinitionFetchNotice
} from './definition-fetch.ts'
import { toUnavailableSources } from './event-row.ts'
import { grantType, toGrantHref } from './grants-page.view-model.ts'
import {
  toDateFact,
  toLinkFact,
  toMonoFact,
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

export interface GrantPageModel extends RecordPageModel {
  versionHeader: VersionHeader
  /** What the fetch that has just landed here did. */
  notices: DefinitionFetchNotice[]
  /** The file the tab needs, while it is not stored. */
  notStored: DefinitionFileType | null
}

const toAllowListHref = (code: string): string =>
  `${toAdminHref(code)}#who-can-apply`

const applicationsBucket = 'gas.applications'

const versionFacts = ['code', 'currentConfigVersion']

const declaresVersionFacts = ({ facts }: BucketEntry): boolean =>
  versionFacts.every((name) => facts.some((fact) => fact.name === name))

/** Null unless the list declares both facts: an undeclared one would drop out of the URL and widen the list. */
const toApplicationsHref = (
  catalogue: Catalogue | null,
  { code, version }: GrantVersionRef
): string | null => {
  const bucket = catalogue?.buckets.find(({ id }) => id === applicationsBucket)

  return bucket && declaresVersionFacts(bucket)
    ? toBucketHref(bucket, { code, currentConfigVersion: version })
    : null
}

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
  from: string,
  {
    notice,
    catalogue
  }: { notice?: DefinitionFetchFlash; catalogue: Catalogue | null }
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
    facts: page.overview
      ? toFacts(
          page.header,
          page.overview,
          toApplicationsHref(catalogue, page.header)
        )
      : null,
    series: null,
    seriesDetailed: false,
    events: null,
    ...toTabSection(page.definition, page.sectionErrors, tab, read),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    versionHeader: toVersionHeader(grantType, page.header, tab, from),
    notices: toDefinitionFetchNotices(
      grantType,
      notice,
      toVersionPath(grantType, page.header)
    ),
    notStored: toNotStored(page.header, tab)
  }
}
