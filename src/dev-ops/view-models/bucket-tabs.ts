import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import { toBucketPath } from './bucket-nav.ts'

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

/** A tab opens the other list as it stands with nothing chosen: no filter, time range or search goes with it. */
const toTab =
  (bucket: BucketEntry) =>
  (other: BucketEntry): PageTab => ({
    id: other.id,
    label: other.tab ?? other.label,
    href: toBucketPath(other),
    active: other.id === bucket.id
  })

/** The page a list is drawn on: its own, or the one it shares, with a tab per list that shares it. */
const titleOf = ({ page, label }: BucketEntry): string => page?.label ?? label

export const toPageHead = (
  bucket: BucketEntry,
  mates: BucketEntry[] = []
): PageHead => ({
  title: titleOf(bucket),
  tabs: mates.length > 1 ? mates.map(toTab(bucket)) : []
})
