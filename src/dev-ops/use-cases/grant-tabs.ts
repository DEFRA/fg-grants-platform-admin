import type {
  DefinitionFileType,
  GrantRead
} from '../repositories/grants.repository.ts'

interface GrantTab {
  read: GrantRead
  /** The file the tab shows; null for a tab that needs none. */
  file: DefinitionFileType | null
}

export const grantTabs = {
  overview: { read: 'overview', file: null },
  raw: { read: 'definition', file: 'grant' }
} as const satisfies Record<string, GrantTab>

export type GrantTabId = keyof typeof grantTabs

export const grantTabIds = Object.keys(grantTabs) as GrantTabId[]
