import type { ApplicationRef } from '../use-cases/get-application-page.use-case.ts'
import { recordTabEntries } from './record-type.ts'
import type { RecordType } from './record-type.ts'

const applicationsPath = '/dev-ops/applications'

export const applicationType: RecordType = {
  listId: 'applications',
  itemId: 'application',
  title: 'Application',
  path: applicationsPath,
  source: 'GAS',
  showClosed: false,
  linkLabel: 'View application',
  tabs: recordTabEntries,
  view: 'record',
  titleParam: 'clientRef'
}

export const toApplicationHref = ({
  code,
  clientRef
}: ApplicationRef): string =>
  `${applicationsPath}/${encodeURIComponent(code)}/${encodeURIComponent(clientRef)}`
