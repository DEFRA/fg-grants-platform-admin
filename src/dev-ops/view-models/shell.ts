import { iconNodes } from '../views/components/nunjucks.ts'
import type { NavSection } from './bucket-nav.ts'

/** Each service's section, by the name its catalogue gives it. */
const sectionTitles: Record<string, string> = {
  GAS: 'Grant Application Service',
  CW: 'Caseworking'
}

const eventsIcon = 'radio-tower'

/** Each page's icon, by its list's catalogue id (or the access tokens page's own id). */
const itemIcons: Record<string, string> = {
  'gas.events': eventsIcon,
  'gas.applications': 'file-text',
  'gas.grants': 'landmark',
  'clients-gas': 'key-round',
  'cw.events': eventsIcon,
  'cw.cases': 'briefcase',
  'cw.workflows': 'workflow',
  'clients-cw': 'key-round'
}

/** A service's own name, by the short one its catalogue uses. */
export const toServiceName = (service: string): string =>
  sectionTitles[service] ?? service

/** Drawn for a list whose icon is neither mapped nor one the icon set has. */
export const fallbackIcon = 'folder'

/** The icon set refuses a name it does not have, which would fail the whole page. */
const isIcon = (name: string): boolean => {
  try {
    iconNodes(name)
    return true
  } catch {
    return false
  }
}

const toIcon = (id: string, declared: string): string => {
  const icon = itemIcons[id] ?? declared

  return isIcon(icon) ? icon : fallbackIcon
}

export interface SidebarItem {
  id: string
  text: string
  href: string
  icon: string
  current: boolean
  /** The service, heard before a page every service has (its events, its access tokens), so each link says whose it is. */
  srPrefix?: string
  testId: string
}

export interface SidebarSection {
  title: string
  /** The service's short name, which the phone strip shows before its pages. */
  short?: string
  items: SidebarItem[]
}

/** The navigation as the sidebar draws it. */
export const toSidebarSections = (
  sections: NavSection[] | undefined,
  navActive: string | null | undefined
): SidebarSection[] =>
  (sections ?? []).map(({ title, items }) => ({
    title: toServiceName(title),
    ...(title && { short: title }),
    items: items.map((item) => ({
      id: item.id,
      text: item.label,
      href: item.href,
      icon: toIcon(item.id, item.icon),
      current: item.id === navActive,
      ...(item.perService && {
        srPrefix: toServiceName(title)
      }),
      testId: `shell-nav-${item.id}`
    }))
  }))

/** A part in one case throughout is cased afresh; a mixed one ("McDonald") was cased on purpose and only gets its capital. */
const toTitlePart = (part: string): string => {
  const cased =
    part === part.toUpperCase() || part === part.toLowerCase()
      ? part.toLowerCase()
      : part

  return cased.charAt(0).toUpperCase() + cased.slice(1)
}

/** "ada LOVELACE-king" is "Ada Lovelace-King"; an email standing in for a name is left as it is. */
export const toTitleCase = (name: string): string =>
  name.includes('@') ? name : name.replace(/[^\s'’-]+/gu, toTitlePart)
