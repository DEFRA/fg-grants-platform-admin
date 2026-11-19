import type {
  BucketEntry,
  Catalogue
} from '../repositories/buckets.repository.ts'
import {
  clientServices,
  serviceWords,
  toClientsPath,
  toNavActive
} from './access-token-services.ts'

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
  label: string
  /** A page every service has (its events, its access tokens): read with its service, as the links are named alike. */
  perService: boolean
  href: string
  icon: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/** A list that declares no icon is drawn with this one. */
const fallbackIcon = 'folder'

/** Event lists live under `events/`, whatever the catalogue calls their link. */
export const isEventList = ({ path }: BucketEntry): boolean =>
  path.startsWith('events/')

const toNavItem = (bucket: BucketEntry): NavItem => ({
  id: bucket.id,
  label: bucket.shortLabel,
  perService: isEventList(bucket),
  href: toBucketPath(bucket),
  icon: bucket.icon ?? fallbackIcon
})

/** Not a bucket: a page of its own, so it is there whether or not the catalogue answers. */
const toAccessTokensItem = (service: 'gas' | 'cw'): NavItem => ({
  id: toNavActive(service),
  label: 'Access tokens',
  perService: true,
  href: toClientsPath(service),
  icon: 'key'
})

/** Last in its service's section, which is made when the catalogue names none. */
const withItem = (
  sections: NavSection[],
  title: string,
  item: NavItem
): NavSection[] =>
  sections.some((section) => section.title === title)
    ? sections.map((section) =>
        section.title === title
          ? { ...section, items: [...section.items, item] }
          : section
      )
    : [...sections, { title, items: [item] }]

const cwListIds = {
  events: 'cw.events',
  cases: 'cw.cases',
  workflows: 'cw.workflows'
}

/** A list of CW's, as the catalogue names it while GAS can reach CW. */
export interface CaseworkingList {
  id: string
  path: string
  pageLabel: string
  shortLabel: string
  noun: string
}

/** What stays in reach while GAS can't reach CW, when the catalogue names none of CW's lists. */
const caseworkingLists: CaseworkingList[] = [
  {
    id: cwListIds.events,
    path: 'events/cw',
    pageLabel: 'CW events',
    shortLabel: 'Events',
    noun: 'events'
  },
  {
    id: cwListIds.cases,
    path: 'cases',
    pageLabel: 'Cases',
    shortLabel: 'Cases',
    noun: 'cases'
  },
  {
    id: cwListIds.workflows,
    path: 'workflows',
    pageLabel: 'Workflows',
    shortLabel: 'Workflows',
    noun: 'workflows'
  }
]

/** The CW list at a path below the admin's root, whether or not the catalogue names it. */
export const toCaseworkingListAt = (path: string): CaseworkingList | null =>
  caseworkingLists.find((list) => list.path === path) ?? null

/** GAS answered, but couldn't reach CW, so CW's lists are missing from the catalogue. */
const isCaseworkingUnreachable = (catalogue: Catalogue | null): boolean =>
  (catalogue?.sourceErrors ?? []).some(({ hop }) => hop === 'CW-BE')

const cwNavItems: NavItem[] = [
  {
    id: cwListIds.events,
    label: 'Events',
    perService: true,
    href: `${devOpsPath}/events/cw`,
    icon: 'activity'
  },
  {
    id: cwListIds.cases,
    label: 'Cases',
    perService: false,
    href: `${devOpsPath}/cases`,
    icon: 'folder'
  },
  {
    id: cwListIds.workflows,
    label: 'Workflows',
    perService: false,
    href: `${devOpsPath}/workflows`,
    icon: 'workflow'
  }
]

const hasCwLists = (sections: NavSection[]): boolean =>
  sections.some(({ title }) => title === serviceWords.cw.short)

/** CW's lists stay in reach, where each page says why it can't be listed. */
const withUnreachable = (
  catalogue: Catalogue | null,
  sections: NavSection[]
) =>
  isCaseworkingUnreachable(catalogue) && !hasCwLists(sections)
    ? [...sections, { title: serviceWords.cw.short, items: cwNavItems }]
    : sections

export const overviewNavId = 'overview'

export const exploreNavId = 'explore'

export const explorePath = `${devOpsPath}/explore`

/** Not lists: the admin's front page and Explore, first and untitled, there whether or not the catalogue answers. */
const overviewSection: NavSection = {
  title: '',
  items: [
    {
      id: overviewNavId,
      label: 'Overview',
      perService: false,
      href: devOpsPath,
      icon: 'layout-dashboard'
    },
    {
      id: exploreNavId,
      label: 'Explore',
      perService: false,
      href: explorePath,
      icon: 'telescope'
    }
  ]
}

/** One section per service, in the order the catalogue first names it, each ending with that service's access tokens. */
export const toNavSections = (catalogue: Catalogue | null): NavSection[] => {
  const buckets = catalogue?.buckets ?? []
  const services = [...new Set(buckets.map(({ service }) => service))]
  const sections = services.map((title) => ({
    title,
    items: buckets.filter(({ service }) => service === title).map(toNavItem)
  }))

  return clientServices.reduce(
    (drawn, service) =>
      withItem(drawn, serviceWords[service].short, toAccessTokensItem(service)),
    withUnreachable(catalogue, sections)
  )
}

/** A record's page carries the list it was opened from as its own `back`. */
const toInnerBack = (back: string): string =>
  new URL(back, 'http://record').searchParams.get('back') ?? ''

const pathOf = (href: string): string => new URL(href, 'http://list').pathname

const listAt = (buckets: BucketEntry[], href: string): BucketEntry | null =>
  href === ''
    ? null
    : (buckets.find((bucket) => toBucketPath(bucket) === pathOf(href)) ?? null)

/** The list a `back` is, itself; null for any other page. */
export const toListAt = (
  catalogue: Catalogue | null,
  back: string
): BucketEntry | null => listAt(catalogue?.buckets ?? [], back)

/** The list a `back` leads to, directly or by way of a record's page: the list a detail page belongs under. */
export const toBackBucket = (
  catalogue: Catalogue | null,
  back: string
): BucketEntry | null => {
  const buckets = catalogue?.buckets ?? []

  return listAt(buckets, back) ?? listAt(buckets, toInnerBack(back))
}

/** What the front door is called on a button: the first list's name. */
export const toHomeLabel = (catalogue: Catalogue | null): string | null =>
  catalogue?.buckets[0]?.label ?? null

/** The sidebar: the Overview, then each service's lists. */
export const toShellNav = (catalogue: Catalogue | null): NavSection[] => [
  overviewSection,
  ...toNavSections(catalogue)
]
