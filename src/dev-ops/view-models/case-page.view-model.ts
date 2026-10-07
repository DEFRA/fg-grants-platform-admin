import type {
  CaseOverview,
  CasePage
} from '../repositories/cases.repository.ts'
import type { RecordTab } from '../repositories/record-page.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import {
  toDateFact,
  toCounterpartFacts,
  toRecordPage,
  toSeriesData,
  toSizeFact,
  toVersionedFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'

const toFacts = (
  overview: CaseOverview,
  applicationHref: string | null
): Fact[][] => [
  [
    toVersionedFact('workflow', 'Workflow', {
      ...overview,
      code: overview.workflowCode
    }),
    ...toCounterpartFacts(applicationType, applicationHref),
    toDateFact('created', 'Created', overview.createdAt),
    toDateFact('closed-at', 'Closed at', overview.closedAt)
  ],
  [toSizeFact(overview.storedBytes)]
]

const toCounterpartHref = ({ header }: CasePage): string | null =>
  header.counterpart?.exists
    ? toApplicationHref({
        code: header.workflowCode,
        clientRef: header.caseRef
      })
    : null

export const toCasePage = (
  page: CasePage,
  tab: RecordTab,
  now: Date = new Date()
): RecordPageModel =>
  toRecordPage(
    caseType,
    {
      ref: page.header.caseRef,
      href: toCaseHref(page.header),
      position: page.header.position,
      facts: page.overview
        ? toFacts(page.overview, toCounterpartHref(page))
        : null,
      series: page.overview
        ? toSeriesData(
            page.overview.series,
            ({ caseRef, ...facts }) => ({ ref: caseRef, ...facts }),
            (caseRef) =>
              toCaseHref({ workflowCode: page.header.workflowCode, caseRef })
          )
        : null,
      events: page.events,
      raw: page.raw,
      sourceErrors: page.sourceErrors,
      sectionErrors: page.sectionErrors
    },
    tab,
    now
  )
