import type { SourceError } from '../repositories/events.repository.ts'
import type {
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from '../repositories/record-page.ts'
import {
  isIsoInstant,
  none,
  toAbsolute,
  toPreciseInstant,
  toSearchHref,
  toStoredTimeCell
} from './event-formats.ts'
import type { TimeCell } from './event-formats.ts'
import { toEventRow, toUnavailableSources } from './events-page.view-model.ts'
import type { EventRow } from './events-page.view-model.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toPositionLabel, toPositionTrail, toStatusLabel } from './position.ts'
import type { PositionStep } from './position.ts'
import type { RecordType } from './record-type.ts'

interface FactBase {
  id: string
  label: string
}

export type Fact = FactBase &
  (
    | { kind: 'mono'; text: string; from: string | null }
    | { kind: 'date'; text: string; instant: string | null }
    | { kind: 'text'; text: string }
    | { kind: 'link'; text: string; href: string }
  )

/** One member of the record's series. */
export interface SeriesMember {
  ref: string
  position: Position
  createdAt: StoredDate
  closedAt: StoredDate
}

interface SeriesData {
  latestRef: string | null
  members: (SeriesMember & { href: string })[]
  /** GAS sent the members' facts, not only their refs. */
  detailed: boolean
}

interface SeriesRow {
  ref: string
  /** Null on the page's own record. */
  href: string | null
  replaced: boolean
  statusLabel: string | null
  positionLabel: string
  /** Null where nothing is stored. */
  created: TimeCell | null
  closed: TimeCell | null
}

interface SectionTab {
  id: RecordTab
  label: string
  href: string
  active: boolean
}

interface EventsTab {
  rows: EventRow[]
  allHref: string | null
}

interface RawTab {
  view: JsonView | null
  tooLarge: boolean
}

/** One record's page, as the service-specific view model reads it out of GAS's answer. */
export interface RecordPageData {
  ref: string
  href: string
  position: Position
  facts: Fact[][] | null
  series?: SeriesData | null
  events?: RecordEvents | null
  raw?: object | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export interface RecordPageModel {
  record: RecordType
  ref: string
  trail: PositionStep[]
  tabs: SectionTab[]
  tab: RecordTab
  facts: Fact[][] | null
  /** Two or more members, or none at all. */
  series: SeriesRow[] | null
  seriesDetailed: boolean
  events: EventsTab | null
  raw: RawTab | null
  sectionError: string | null
  unavailableSources: string
}

const tabLabels: Record<RecordTab, string> = {
  overview: 'Overview',
  events: 'Events',
  raw: 'Raw'
}

const toTabHref = (href: string, tab: RecordTab): string =>
  tab === 'overview' ? href : `${href}?section=${tab}`

const toTabs = (href: string, active: RecordTab): SectionTab[] =>
  (Object.keys(tabLabels) as RecordTab[]).map((id) => ({
    id,
    label: tabLabels[id],
    href: toTabHref(href, id),
    active: id === active
  }))

const kib = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

const bytesPerKib = 1024

export const toSizeFact = (bytes: number | null): Fact => ({
  id: 'size',
  label: 'Size',
  kind: 'text',
  text: bytes === null ? none : `${kib.format(bytes / bytesPerKib)} KiB`
})

/** Anything but an ISO instant is shown as stored, so a malformed date is never read as another. */
const toDateText = (value: StoredDate) => {
  if (value === null) {
    return { text: none, instant: null }
  }

  return isIsoInstant(value)
    ? { text: toPreciseInstant(new Date(value)), instant: toAbsolute(value) }
    : { text: value, instant: null }
}

export const toDateFact = (
  id: string,
  label: string,
  value: StoredDate
): Fact => ({ id, label, kind: 'date', ...toDateText(value) })

export const toMonoFact = (
  id: string,
  label: string,
  value: string | null
): Fact => ({ id, label, kind: 'mono', text: value ?? none, from: null })

interface Versions {
  code: string
  currentConfigVersion: string | null
  originalConfigVersion: string | null
}

/** `frps-private-beta@1.4.2`, and where it started when that was another version. */
export const toVersionedFact = (
  id: string,
  label: string,
  { code, currentConfigVersion, originalConfigVersion }: Versions
): Fact => ({
  id,
  label,
  kind: 'mono',
  text: currentConfigVersion ? `${code}@${currentConfigVersion}` : code,
  from:
    originalConfigVersion && originalConfigVersion !== currentConfigVersion
      ? originalConfigVersion
      : null
})

/** The other record as a fact named for its type; no row at all when there is no link to follow. */
export const toCounterpartFacts = (
  { itemId, title, linkLabel }: RecordType,
  href: string | null
): Fact[] =>
  href
    ? [{ id: itemId, label: title, kind: 'link', text: linkLabel, href }]
    : []

const noFacts = {
  position: { phase: null, stage: null, status: null },
  createdAt: null,
  closedAt: null
}

/** Every ref in the series is a row, oldest first, with whatever GAS sent of its member. */
export const toSeriesData = <Member>(
  series: RecordSeries<Member> | null,
  toMember: (member: Member) => SeriesMember,
  hrefOf: (ref: string) => string
): SeriesData | null => {
  if (series === null) {
    return null
  }

  const byRef = new Map(
    (series.members ?? []).map((member) => {
      const known = toMember(member)

      return [known.ref, known]
    })
  )

  return {
    latestRef: series.latestRef,
    members: series.refs.map((ref) => ({
      ...noFacts,
      ...byRef.get(ref),
      ref,
      href: hrefOf(ref)
    })),
    detailed: series.members !== undefined
  }
}

const toSeriesRow =
  (ref: string, latestRef: string | null, now: Date) =>
  (member: SeriesData['members'][number]): SeriesRow => ({
    ref: member.ref,
    href: member.ref === ref ? null : member.href,
    replaced: latestRef !== null && member.ref !== latestRef,
    statusLabel: toStatusLabel(member.position),
    positionLabel: toPositionLabel(member.position),
    created: toStoredTimeCell(member.createdAt, now),
    closed: toStoredTimeCell(member.closedAt, now)
  })

const minSeriesLength = 2

const toSeries = (
  { ref, series }: RecordPageData,
  now: Date
): SeriesRow[] | null =>
  series && series.members.length >= minSeriesLength
    ? series.members.map(toSeriesRow(ref, series.latestRef, now))
    : null

const isDetailed = ({ series }: RecordPageData): boolean =>
  series?.detailed ?? false

/** No list query: the event page's Back returns to the whole events list. */
const noListQuery = ''

const toEvents = (
  events: RecordEvents | null | undefined,
  ref: string,
  now: Date
): EventsTab | null =>
  events
    ? {
        rows: events.rows.map(toEventRow(now, noListQuery)),
        allHref: events.more ? toSearchHref(ref) : null
      }
    : null

/** GAS's own words for a document it will not show; any other Raw failure is an error like any tab's. */
const tooLargeToShow = 'too large to show'

const isTooLarge = ({ section, message }: RecordSectionError): boolean =>
  section === 'raw' && message === tooLargeToShow

const toRaw = ({ raw, sectionErrors }: RecordPageData): RawTab => ({
  view: raw ? toJsonView(raw) : null,
  tooLarge: sectionErrors.some(isTooLarge)
})

const toSectionError = (
  { sectionErrors }: RecordPageData,
  tab: RecordTab
): string | null =>
  sectionErrors.find((error) => error.section === tab && !isTooLarge(error))
    ?.message ?? null

export const toRecordPage = (
  record: RecordType,
  data: RecordPageData,
  tab: RecordTab,
  now: Date = new Date()
): RecordPageModel => ({
  record,
  ref: data.ref,
  trail: toPositionTrail(data.position),
  tabs: toTabs(data.href, tab),
  tab,
  facts: data.facts,
  series: toSeries(data, now),
  seriesDetailed: isDetailed(data),
  events: toEvents(data.events, data.ref, now),
  raw: tab === 'raw' ? toRaw(data) : null,
  sectionError: toSectionError(data, tab),
  unavailableSources: toUnavailableSources(data.sourceErrors)
})
