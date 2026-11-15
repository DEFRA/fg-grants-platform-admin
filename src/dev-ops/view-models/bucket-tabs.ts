import type { BucketEntry } from '../repositories/buckets.repository.ts'
import { toBucketHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { fromUrlQuery, toUrlQuery, withOfferedValues } from './bucket-urls.ts'

export interface PageTab {
  id: string
  label: string
  href: string
  active: boolean
}

export interface PageHead {
  title: string
  tabs: PageTab[]
}

/** The lists of the same service that are tabs of the same page, this one among them, in catalogue order. */
export const pageMates = (
  bucket: BucketEntry,
  buckets: BucketEntry[]
): BucketEntry[] =>
  buckets.filter(
    ({ service, page }) =>
      bucket.page !== null &&
      service === bucket.service &&
      page?.id === bucket.page.id
  )

/** What the other list can be filtered by of this one's filters: the time range, and each key both declare, with only the values the other offers. */
const toCarried = (
  bucket: BucketEntry,
  other: BucketEntry,
  filters: BucketFilters
): BucketFilters =>
  fromUrlQuery(other, withOfferedValues(other, toUrlQuery(bucket, filters)))

/** A tab opens the other list on the filters it shares with this one; a search stays with the list it was made on. */
const toTab =
  (bucket: BucketEntry, filters: BucketFilters) =>
  (other: BucketEntry): PageTab => ({
    id: other.id,
    label: other.tab ?? other.label,
    href: toBucketHref(other, toCarried(bucket, other, filters)),
    active: other.id === bucket.id
  })

/** The page a list is drawn on: its own, or the one it shares, with a tab per list that shares it. */
const titleOf = ({ page, label }: BucketEntry): string => page?.label ?? label

export const toPageHead = (
  bucket: BucketEntry,
  mates: BucketEntry[] = [],
  filters: BucketFilters = {}
): PageHead => ({
  title: titleOf(bucket),
  tabs: mates.length > 1 ? mates.map(toTab(bucket, filters)) : []
})
