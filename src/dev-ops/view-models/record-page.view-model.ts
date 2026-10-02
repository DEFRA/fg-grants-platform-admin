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
  toSearchHref
} from './event-formats.ts'
import { toEventRow } from './events-page.view-model.ts'
import type { EventRow } from './events-page.view-model.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toPositionTrail } from './position.ts'
import type { PositionStep } from './position.ts'
import type { RecordType } from './record-type.ts'

interface SeriesLink {
  ref: string
  href: string | null
  latest: boolean
}

interface FactBase {
  id: string
  label: string
}

export type Fact = FactBase &
  (
    | { kind: 'mono'; text: string; from: string | null }
    | { kind: 'date'; text: string; instant: string | null }
    | { kind: 'text'; text: string }
    | { kind: 'series'; items: SeriesLink[] }
  )

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
  counterpartHref: string | null
  facts: Fact[][] | null
  events?: RecordEvents | null
  raw?: object | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export interface RecordPageModel {
  record: RecordType
  ref: string
  trail: PositionStep[]
  counterpartHref: string | null
  counterpartUnknown: boolean
  tabs: SectionTab[]
  tab: RecordTab
  facts: Fact[][] | null
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

/** The series is one code's, so each ref links under that same code; the page's own ref is not a link. */
export const toSeriesFact = (
  series: RecordSeries | null,
  ref: string,
  hrefOf: (ref: string) => string
): Fact => ({
  id: 'series',
  label: 'Series',
  kind: 'series',
  items: (series?.refs ?? []).map((item) => ({
    ref: item,
    href: item === ref ? null : hrefOf(item),
    latest: item === series?.latestRef
  }))
})

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

/** Unknown, not absent: the other record could not be checked, so neither is a link. An event source failing says nothing about it. */
const isCounterpartUnknown = (
  { counterpartCheck }: RecordType,
  { sourceErrors }: RecordPageData
): boolean =>
  counterpartCheck !== null &&
  sourceErrors.some(({ hop }) => hop === counterpartCheck.hop)

/** Event sources only: the check of the other record has its own warning. */
const toUnavailableSources = (
  { counterpartCheck }: RecordType,
  sourceErrors: SourceError[]
): string =>
  sourceErrors
    .map(({ hop }) => hop)
    .filter((hop) => hop !== counterpartCheck?.hop)
    .join(', ')

export const toRecordPage = (
  record: RecordType,
  data: RecordPageData,
  tab: RecordTab,
  now: Date = new Date()
): RecordPageModel => ({
  record,
  ref: data.ref,
  trail: toPositionTrail(data.position),
  counterpartHref: data.counterpartHref,
  counterpartUnknown: isCounterpartUnknown(record, data),
  tabs: toTabs(data.href, tab),
  tab,
  facts: data.facts,
  events: toEvents(data.events, data.ref, now),
  raw: tab === 'raw' ? toRaw(data) : null,
  sectionError: toSectionError(data, tab),
  unavailableSources: toUnavailableSources(record, data.sourceErrors)
})
