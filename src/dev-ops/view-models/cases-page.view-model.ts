import type { CaseRef } from '../use-cases/get-case-page.use-case.ts'
import type { RecordType } from './record-type.ts'

const casesPath = '/dev-ops/cases'

export const caseType: RecordType = {
  listId: 'cases',
  itemId: 'case',
  title: 'Case',
  path: casesPath,
  source: 'CW',
  showClosed: true,
  linkLabel: 'View case'
}

export const toCaseHref = ({ workflowCode, caseRef }: CaseRef): string =>
  `${casesPath}/${encodeURIComponent(workflowCode)}/${encodeURIComponent(caseRef)}`
