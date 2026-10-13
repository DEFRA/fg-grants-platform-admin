import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'

export const devOpsPath = '/dev-ops'

/** A list's own URL, from the path its bucket declares. */
export const toBucketPath = ({ path }: Pick<BucketEntry, 'path'>): string =>
  `${devOpsPath}/${path}`

/** The first list the catalogue names: the admin has no front page of its own. */
export const toHomeHref = (catalogue: Catalogue | null): string | null => {
  const [first] = catalogue?.buckets ?? []

  return first ? toBucketPath(first) : null
}

interface NavItem {
  id: string
  /** Every list the link stands for: it is the current one on any of them. */
  ids: string[]
  label: string
  href: string
  icon: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/** A list that declares no icon is drawn with this one. */
const fallbackIcon = 'folder'

const toKey = ({ id, page }: BucketEntry): string =>
  page === null ? `list:${id}` : `page:${page.id}`

const toNavItem = (bucket: BucketEntry): NavItem => ({
  id: bucket.id,
  ids: [],
  label: bucket.page?.shortLabel ?? bucket.shortLabel,
  href: toBucketPath(bucket),
  icon: bucket.icon ?? fallbackIcon
})

/** One link per page: a list with a page of its own, or the lists that share one, opening on the first. */
const toNavItems = (buckets: BucketEntry[]): NavItem[] => {
  const items = new Map<string, NavItem>()

  for (const bucket of buckets) {
    const item = items.get(toKey(bucket)) ?? toNavItem(bucket)

    items.set(toKey(bucket), { ...item, ids: [...item.ids, bucket.id] })
  }

  return [...items.values()]
}

/** One section per service, in the order the catalogue first names it; no catalogue is no navigation. */
export const toNavSections = (catalogue: Catalogue | null): NavSection[] => {
  const buckets = catalogue?.buckets ?? []
  const services = [...new Set(buckets.map(({ service }) => service))]

  return services.map((title) => ({
    title,
    items: toNavItems(buckets.filter(({ service }) => service === title))
  }))
}

/** A record's page carries the list it was opened from as its own `back`. */
const toInnerBack = (back: string): string =>
  new URL(back, 'http://record').searchParams.get('back') ?? ''

const pathOf = (href: string): string => new URL(href, 'http://list').pathname

const listAt = (buckets: BucketEntry[], href: string): BucketEntry | null =>
  href === ''
    ? null
    : (buckets.find((bucket) => toBucketPath(bucket) === pathOf(href)) ?? null)

/** The list a `back` leads to, directly or by way of a record's page: the list a detail page belongs under. */
export const toBackBucket = (
  catalogue: Catalogue | null,
  back: string
): BucketEntry | null => {
  const buckets = catalogue?.buckets ?? []

  return listAt(buckets, back) ?? listAt(buckets, toInnerBack(back))
}
