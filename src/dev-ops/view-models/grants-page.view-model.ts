import type { GrantVersionRef } from '../use-cases/get-grant-page.use-case.ts'
import { type GrantTabId, grantTabIds } from '../use-cases/grant-tabs.ts'
import type { RecordType } from './record-type.ts'

const grantsPath = '/dev-ops/grants'

const grantTabLabels: Record<GrantTabId, string> = {
  overview: 'Overview',
  phases: 'Phases',
  entitlements: 'Entitlements',
  payment: 'Payment',
  raw: 'Raw'
}

export const grantType: RecordType = {
  listId: 'grants',
  itemId: 'grant',
  title: 'Grant',
  path: grantsPath,
  source: 'GAS',
  showClosed: false,
  linkLabel: 'View grant',
  tabs: grantTabIds.map((id) => ({ id, label: grantTabLabels[id] })),
  view: 'grant',
  titleParam: 'code'
}

export const toGrantHref = ({ code, version }: GrantVersionRef): string =>
  `${grantsPath}/${encodeURIComponent(code)}/${encodeURIComponent(version)}`
