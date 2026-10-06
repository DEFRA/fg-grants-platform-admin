import type {
  ApplicationOverview,
  ApplicationPage,
  ApplicationSeries,
  ApplicationTab,
  RecordSectionError,
  StoredDate
} from '../repositories/applications.repository.ts'
import { caseCheckHop } from '../repositories/applications.repository.ts'
import type { SourceError } from '../repositories/events.repository.ts'
import {
  isIsoInstant,
  none,
  toAbsolute,
  toPreciseInstant,
  toSearchHref
} from './event-formats.ts'
import {
  applicationsPath,
  toApplicationHref
} from './applications-page.view-model.ts'
import { toEventRow } from './events-page.view-model.ts'
import type { EventRow } from './events-page.view-model.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toPositionTrail } from './position.ts'
import type { PositionStep } from './position.ts'

interface SectionTab {
  id: ApplicationTab
  label: string
  href: string
  active: boolean
}

interface DateFact {
  text: string
  instant: string | null
}

interface SeriesLink {
  ref: string
  href: string | null
  latest: boolean
}

interface OverviewFacts {
  grant: string
  grantFrom: string | null
  submitted: DateFact
  created: DateFact
  updated: DateFact
  sbi: string
  frn: string
  crn: string
  series: SeriesLink[]
  size: string
}

interface EventsTab {
  rows: EventRow[]
  allHref: string | null
}

interface RawTab {
  view: JsonView | null
  tooLarge: boolean
}

export interface ApplicationPageModel {
  clientRef: string
  trail: PositionStep[]
  caseHref: string | null
  caseUnknown: boolean
  tabs: SectionTab[]
  tab: ApplicationTab
  overview: OverviewFacts | null
  events: EventsTab | null
  raw: RawTab | null
  sectionError: string | null
  unavailableSources: string
  backHref: string
}

const tabLabels: Record<ApplicationTab, string> = {
  overview: 'Overview',
  events: 'Events',
  raw: 'Raw'
}

const toTabHref = (href: string, tab: ApplicationTab): string =>
  tab === 'overview' ? href : `${href}?section=${tab}`

const toTabs = (href: string, active: ApplicationTab): SectionTab[] =>
  (Object.keys(tabLabels) as ApplicationTab[]).map((id) => ({
    id,
    label: tabLabels[id],
    href: toTabHref(href, id),
    active: id === active
  }))

const kib = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

const bytesPerKib = 1024

export const toSizeLabel = (bytes: number | null | undefined): string =>
  typeof bytes === 'number' ? `${kib.format(bytes / bytesPerKib)} KiB` : none

/** Anything but an ISO instant is shown as stored, so a malformed date is never read as another. */
const toDateFact = (value: StoredDate): DateFact => {
  if (value === null) {
    return { text: none, instant: null }
  }

  return isIsoInstant(value)
    ? { text: toPreciseInstant(new Date(value)), instant: toAbsolute(value) }
    : { text: value, instant: null }
}

/** `frps-private-beta@1.4.2`, and where it started when that was another version. */
const toGrant = ({
  code,
  currentConfigVersion,
  originalConfigVersion
}: ApplicationOverview) => ({
  grant: currentConfigVersion ? `${code}@${currentConfigVersion}` : code,
  grantFrom:
    originalConfigVersion && originalConfigVersion !== currentConfigVersion
      ? originalConfigVersion
      : null
})

/** The series is one grant's, so each ref links under that same code; the page's own ref is not a link. */
const toSeries = (
  series: ApplicationSeries | null,
  { code, clientRef }: { code: string; clientRef: string }
): SeriesLink[] =>
  (series?.refs ?? []).map((ref) => ({
    ref,
    href:
      ref === clientRef ? null : toApplicationHref({ code, clientRef: ref }),
    latest: ref === series?.latestRef
  }))

const toOverview = (
  overview: ApplicationOverview,
  clientRef: string
): OverviewFacts => ({
  ...toGrant(overview),
  submitted: toDateFact(overview.submittedAt),
  created: toDateFact(overview.createdAt),
  updated: toDateFact(overview.updatedAt),
  sbi: overview.identifiers.sbi ?? none,
  frn: overview.identifiers.frn ?? none,
  crn: overview.identifiers.crn ?? none,
  series: toSeries(overview.series, { code: overview.code, clientRef }),
  size: toSizeLabel(overview.storedBytes)
})

/** No list query: the event page's Back returns to the whole events list. */
const noListQuery = ''

const toEvents = (
  { events }: ApplicationPage,
  clientRef: string,
  now: Date
): EventsTab | null =>
  events
    ? {
        rows: events.rows.map(toEventRow(now, noListQuery)),
        allHref: events.more ? toSearchHref(clientRef) : null
      }
    : null

/** GAS's own words for a document over its 1 MiB cap; any other Raw failure is an error like any tab's. */
const tooLargeToShow = 'too large to show'

const isTooLarge = ({ section, message }: RecordSectionError): boolean =>
  section === 'raw' && message === tooLargeToShow

const toRaw = (page: ApplicationPage): RawTab => ({
  view: page.raw ? toJsonView(page.raw) : null,
  tooLarge: page.sectionErrors.some(isTooLarge)
})

const toSectionError = (
  { sectionErrors }: ApplicationPage,
  tab: ApplicationTab
): string | null =>
  sectionErrors.find((error) => error.section === tab && !isTooLarge(error))
    ?.message ?? null

/** Event sources only: the case check has its own warning. */
const toUnavailableSources = (sourceErrors: SourceError[]): string =>
  sourceErrors
    .map(({ hop }) => hop)
    .filter((hop) => hop !== caseCheckHop)
    .join(', ')

/** Unknown, not absent: the case check could not be made, so neither is a link. An event source failing says nothing about the case. */
const isCaseUnknown = ({ sourceErrors }: ApplicationPage): boolean =>
  sourceErrors.some(({ hop }) => hop === caseCheckHop)

const toCaseHref = ({ header }: ApplicationPage): string | null =>
  header.counterpart?.exists
    ? `/dev-ops/cases/${encodeURIComponent(header.code)}/${encodeURIComponent(header.clientRef)}`
    : null

export const toApplicationPage = (
  page: ApplicationPage,
  tab: ApplicationTab,
  now: Date = new Date()
): ApplicationPageModel => {
  const { clientRef } = page.header

  return {
    clientRef,
    trail: toPositionTrail(page.header.position),
    caseHref: toCaseHref(page),
    caseUnknown: isCaseUnknown(page),
    tabs: toTabs(toApplicationHref(page.header), tab),
    tab,
    overview: page.overview ? toOverview(page.overview, clientRef) : null,
    events: toEvents(page, clientRef, now),
    raw: tab === 'raw' ? toRaw(page) : null,
    sectionError: toSectionError(page, tab),
    unavailableSources: toUnavailableSources(page.sourceErrors),
    backHref: applicationsPath
  }
}
