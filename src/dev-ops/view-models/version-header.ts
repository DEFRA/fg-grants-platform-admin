import type { BadgeRole } from '../use-cases/get-event.use-case.ts'
import type {
  DefinitionFileType,
  GrantVersionHeader,
  GrantVersionRef,
  GrantVersionSummary
} from '../use-cases/get-grant-page.use-case.ts'
import { toDayClock, toValidDate } from './event-formats.ts'
import { toTabHref } from './record-page.view-model.ts'
import type { RecordType } from './record-type.ts'

interface StatusBadge {
  status: string
  role: BadgeRole
}

/** The shared filter menu's link items, with no `value`: a version is a page, never a filter. */
interface SwitcherItem {
  label: string
  status: StatusBadge
  aside: string
  href: string
  active: boolean
}

export interface VersionHeader {
  status: StatusBadge
  switcher: {
    name: string
    label: string
    small: true
    testId: string
    panelId: string
    items: SwitcherItem[]
  }
  /** The files not stored, while there are any. */
  banner: { text: string } | null
}

const statuses: Record<GrantVersionSummary['status'], StatusBadge> = {
  active: { status: 'Active', role: 'success' },
  draft: { status: 'Draft', role: 'neutral' }
}

const fileOrder: DefinitionFileType[] = ['grant', 'agreement', 'payment']

const toAndList = (words: string[]): string =>
  words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

const toBanner = (
  { source }: RecordType,
  { files }: GrantVersionHeader
): VersionHeader['banner'] => {
  const missing = fileOrder.filter((type) => files[type]?.stored === false)

  if (!missing.length) {
    return null
  }

  const unused = missing.some(
    (type) => files[type]?.fetchStatus === 'permanent_error'
  )
  const noun = missing.length > 1 ? 'definitions' : 'definition'

  return {
    text: `${capitalise(toAndList(missing))} ${noun} not stored.${unused ? ` ${source} won't use this version.` : ''}`
  }
}

export const toVersionPath = (
  { path }: RecordType,
  { code, version }: GrantVersionRef
): string =>
  `${path}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`

/** Anything but a date is shown as stored. */
const toReceived = (receivedAt: string): string => {
  const date = toValidDate(receivedAt)

  return date ? toDayClock(date) : receivedAt
}

export const toVersionHeader = (
  record: RecordType,
  header: GrantVersionHeader,
  tab: string,
  from: string
): VersionHeader => ({
  status: statuses[header.status],
  switcher: {
    name: 'Version',
    label: `Versions of ${header.code}`,
    small: true,
    testId: `${record.itemId}-switcher`,
    panelId: `${record.itemId}-switcher-panel`,
    items: header.versions.map(({ version, status, receivedAt }) => ({
      label: version,
      status: statuses[status],
      aside: toReceived(receivedAt),
      href: toTabHref(
        toVersionPath(record, { code: header.code, version }),
        tab,
        from
      ),
      active: version === header.version
    }))
  },
  banner: toBanner(record, header)
})
