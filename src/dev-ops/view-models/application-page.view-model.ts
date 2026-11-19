import type {
  ApplicationOverview,
  ApplicationPage
} from '../use-cases/get-application-page.use-case.ts'
import type { Catalogue } from '../repositories/buckets.repository.ts'
import type { RecordTab } from '../use-cases/record-reads.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { toCaseHref } from './cases-page.view-model.ts'
import { toEventsHref } from './events-list.ts'
import { toGrantHref } from './grants-page.view-model.ts'
import { toTabHref } from './record-page.view-model.ts'
import { toEventsTab, toSectionError } from './record-events-tab.ts'
import type { EventsCopy, TabNotice } from './record-events-tab.ts'
import { toFindOthers } from './explore-queries.view-model.ts'
import { toRawTab } from './record-raw-tab.ts'
import { toReplacedAlert, toSeries } from './record-series.ts'
import type { SeriesModel } from './record-series.ts'
import { readsTheSame, toRecordTime } from './record-times.ts'
import type { RecordTime } from './record-times.ts'
import {
  caseOf,
  noTabBodies,
  toBackHref,
  toLinkBack,
  toRecordTabs,
  toVersionLink
} from './record-view.ts'
import type {
  CounterpartCard,
  PageOptions,
  RecordView,
  TabBodies,
  VersionLink
} from './record-view.ts'
import { toStatusName, toWhere } from './record-where.ts'
import type { Where } from './record-where.ts'

interface Identifier {
  label: string
  text: string | null
  mono: true
  copy: true
}

export interface ApplicationOverviewModel {
  kind: 'shown'
  where: Where
  case: CounterpartCard
  series: SeriesModel | null
  details: {
    grantVersion: VersionLink
    submitted: RecordTime | null
    /** Null when it reads the same as Submitted. */
    updated: RecordTime | null
  }
  /** Each copied whole, so mono with a copy button; none without a value. */
  identifiers: Identifier[]
}

export type ApplicationPageModel = RecordView<ApplicationOverviewModel>

const unexpected = (subject: string) => ({
  title: 'This tab couldn’t be read.',
  text: `GAS returned an unexpected answer for this application’s ${subject}. The rest of the page is unaffected.`
})

const nothing = 'GAS returned no data for this tab.'

const eventsCopy: EventsCopy = {
  error: unexpected('events'),
  nothing,
  empty: {
    title: 'No events found',
    text: 'GAS holds no events for this application. Events past their deletion date aren’t listed.'
  },
  source: 'GAS',
  unreachable: null
}

const rawCopy = {
  noun: 'application',
  error: unexpected('stored document'),
  nothing
}

/** GAS's outbox, filtered to CreateCase: search refs live in the session, so it can't be opened at this reference. */
const toCreateCaseHref = (catalogue: Catalogue | null): string | null =>
  toEventsHref(catalogue, {
    service: 'gas',
    box: 'outbox',
    filters: { eventType: 'CreateCase' },
    clear: true
  })

const toNoCaseCard = (catalogue: Catalogue | null): CounterpartCard => {
  const href = toCreateCaseHref(catalogue)

  return {
    kind: 'missing',
    title: 'Case',
    empty: {
      icon: 'briefcase',
      title: 'No case for this application',
      text: 'Caseworking holds no case with this reference. GAS sends CreateCase when the application arrives; check the outbox for it.'
    },
    button: href ? { text: 'Find its CreateCase event', href } : null
  }
}

/** The case is this application's by construction, so it can be opened even when CW couldn't say it's there. */
const toCaseCard = (
  { header }: ApplicationPage,
  { catalogue, from }: PageOptions
): CounterpartCard => {
  if (header.counterpart?.exists === false) {
    return toNoCaseCard(catalogue)
  }

  return {
    kind: 'link',
    title: 'Case',
    text: header.counterpart
      ? 'Caseworking holds the case for this application.'
      : 'Caseworking didn’t say whether it holds a case for this application.',
    button: {
      text: 'Open case',
      href: toLinkBack(
        toCaseHref(caseOf(header)),
        toApplicationHref(header),
        from
      )
    }
  }
}

/** Another member keeps the list this one was opened from, so Back still returns there. */
const seriesHrefOf =
  ({ header }: ApplicationPage, from: string) =>
  (clientRef: string) =>
    toTabHref(
      toApplicationHref({ code: header.code, clientRef }),
      'overview',
      from
    )

const toDetails = (
  { header }: ApplicationPage,
  overview: ApplicationOverview,
  { times, from }: PageOptions
): ApplicationOverviewModel['details'] => {
  const submitted = toRecordTime(overview.submittedAt, times)
  const updated = toRecordTime(overview.updatedAt, times)

  return {
    grantVersion: toVersionLink(
      overview.code,
      overview.currentConfigVersion,
      toGrantHref,
      toApplicationHref(header),
      from
    ),
    submitted,
    updated: readsTheSame(updated, submitted) ? null : updated
  }
}

const toOverview = (
  page: ApplicationPage,
  overview: ApplicationOverview,
  options: PageOptions
): ApplicationOverviewModel => ({
  kind: 'shown',
  where: toWhere(page.header.position, page.header.names),
  case: toCaseCard(page, options),
  series: toSeries(
    overview.series,
    ({ clientRef, createdAt }) => ({
      ref: clientRef,
      createdAt,
      closedAt: null
    }),
    {
      current: page.header.clientRef,
      source: 'GAS',
      showClosed: false,
      hrefOf: seriesHrefOf(page, options.from),
      times: options.times
    }
  ),
  details: toDetails(page, overview, options),
  identifiers: (['sbi', 'frn', 'crn'] as const).map((key) => ({
    label: key.toUpperCase(),
    text: overview.identifiers[key],
    mono: true,
    copy: true
  }))
})

const toOverviewTab = (
  page: ApplicationPage,
  options: PageOptions,
  tabHref: string
): ApplicationOverviewModel | TabNotice => {
  if (toSectionError(page.sectionErrors, 'overview')) {
    return {
      kind: 'error',
      error: { ...unexpected('details'), retryHref: tabHref }
    }
  }

  return page.overview
    ? toOverview(page, page.overview, options)
    : { kind: 'nothing', title: nothing }
}

const tabBodies: Record<
  RecordTab,
  TabBodies<ApplicationPage, ApplicationOverviewModel>
> = {
  overview: (page, options, tabHref) => ({
    alert: toReplacedAlert(page.overview?.series ?? null, {
      current: page.header.clientRef,
      noun: 'application',
      source: 'GAS',
      hrefOf: seriesHrefOf(page, options.from)
    }),
    overview: toOverviewTab(page, options, tabHref)
  }),
  events: (page, { times }, tabHref) => ({
    events: toEventsTab(page, eventsCopy, tabHref, times)
  }),
  raw: (page, _options, tabHref) => ({
    raw: toRawTab(page, rawCopy, tabHref)
  })
}

export const toApplicationPage = (
  page: ApplicationPage,
  tab: RecordTab,
  options: PageOptions
): ApplicationPageModel => {
  const { header } = page
  const href = toApplicationHref(header)

  return {
    record: applicationType,
    navActive: null,
    ref: header.clientRef,
    backHref: toBackHref(applicationType, options.from),
    status: toStatusName(header.position, header.names),
    tab,
    findOthers: toFindOthers(href),
    tabs: toRecordTabs(applicationType, href, tab, options.from),
    ...noTabBodies,
    ...tabBodies[tab](page, options, toTabHref(href, tab, options.from))
  }
}
