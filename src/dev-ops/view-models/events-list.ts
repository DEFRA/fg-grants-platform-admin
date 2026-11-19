import type {
  BucketEntry,
  BucketFact,
  Catalogue
} from '../repositories/buckets.repository.ts'
import { queueFact } from '../use-cases/list-bucket.use-case.ts'
import type { BucketFilters, FilterValue } from './bucket-links.ts'
import { devOpsPath } from './bucket-nav.ts'
import { toUrlQuery } from './bucket-urls.ts'
import type { UrlService } from './event-address.ts'
import { toFilterHref } from './list-filters.ts'
import { clearParam } from './list-page.view-model.ts'

export type EventsBox = 'outbox' | 'inbox'

/** The status of an event that has used up its attempts. */
export const deadLetterStatus = 'DEAD_LETTER'

/** The Events page's presentation, which every event of the service is toned by. */
export const eventsPresentationId = (service: UrlService): string =>
  `${service}.events`

const groupPath = (service: UrlService): string => `events/${service}`

/** The service's Events page, as its address spells it; encoded, as an event's address is. */
export const toEventsPageHref = (service: UrlService): string =>
  `${devOpsPath}/events/${encodeURIComponent(service)}`

const queueOf = (entry: BucketEntry | null): BucketFact | null =>
  entry?.facts.find(({ name }) => name === queueFact) ?? null

/** A value by the label its fact gives it, else as it is. */
const toValueLabel = (fact: BucketFact, value: string): string =>
  fact.values?.find((one) => String(one.value) === value)?.label ?? value

const entryAt = (catalogue: Catalogue | null, path: string) =>
  catalogue?.buckets.find((bucket) => bucket.path === path) ?? null

/** The lists GAS sent hold one at the path. */
export const isListed = (catalogue: Catalogue | null, path: string): boolean =>
  entryAt(catalogue, path) !== null

/** The queue a link into a list of events picks, by its label; null for none. */
export const toQueueLabel = (
  catalogue: Catalogue | null,
  { path, query }: { path: string; query: Record<string, string> }
): string | null => {
  const fact = queueOf(entryAt(catalogue, path))
  const value = fact && query[fact.param]

  return fact && value ? toValueLabel(fact, value) : null
}

export interface EventsAsk {
  service: UrlService
  /** The queue to pick; none for every queue. */
  box?: EventsBox | null
  /** By fact name. */
  filters?: BucketFilters
  /** Arrives with any search held on the page cleared. */
  clear?: boolean
}

/** The list the service's events are on, its Events page; null when the catalogue doesn't list it. */
export const toEventsEntry = (
  catalogue: Catalogue | null,
  service: UrlService
): BucketEntry | null => entryAt(catalogue, groupPath(service))

export interface EventsList {
  path: string
  query: Record<string, FilterValue>
}

const isSet = (
  entry: [string, FilterValue | undefined]
): entry is [string, FilterValue] => entry[1] !== undefined

const toQuery = (
  entry: BucketEntry,
  { box, filters = {} }: EventsAsk
): EventsList['query'] =>
  Object.fromEntries(
    Object.entries(
      toUrlQuery(entry, box ? { ...filters, [queueFact]: box } : filters)
    ).filter(isSet)
  )

/** Filters by fact name, spelt as the list's URL spells them, with the queue picked when one is given. */
export const toEventsList = (
  catalogue: Catalogue | null,
  ask: EventsAsk
): EventsList | null => {
  const entry = toEventsEntry(catalogue, ask.service)

  return (
    entry && {
      path: `${devOpsPath}/${entry.path}`,
      query: {
        ...toQuery(entry, ask),
        ...(ask.clear ? { [clearParam]: 'all' } : {})
      }
    }
  )
}

export const toEventsHref = (
  catalogue: Catalogue | null,
  ask: EventsAsk
): string | null => {
  const list = toEventsList(catalogue, ask)

  return list && toFilterHref(list.path, Object.keys(list.query), list.query)
}
