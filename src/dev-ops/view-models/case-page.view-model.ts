import type {
  CaseOverview,
  CasePage
} from '../repositories/cases.repository.ts'
import type { RecordTab } from '../repositories/record-page.ts'
import { toApplicationHref } from './applications-page.view-model.ts'
import { caseType, toCaseHref } from './cases-page.view-model.ts'
import {
  toDateFact,
  toRecordPage,
  toSeriesFact,
  toSizeFact,
  toVersionedFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'

const toFacts = (overview: CaseOverview, caseRef: string): Fact[][] => [
  [
    toVersionedFact('workflow', 'Workflow', {
      ...overview,
      code: overview.workflowCode
    }),
    toDateFact('created', 'Created', overview.createdAt),
    toDateFact(
      'closed-at',
      'Closed at',
      overview.closed ? overview.closedAt : null
    )
  ],
  [
    toSeriesFact(overview.series, caseRef, (ref) =>
      toCaseHref({ workflowCode: overview.workflowCode, caseRef: ref })
    ),
    toSizeFact(overview.storedBytes)
  ]
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
      counterpartHref: toCounterpartHref(page),
      facts: page.overview ? toFacts(page.overview, page.header.caseRef) : null,
      events: page.events,
      raw: page.raw,
      sourceErrors: page.sourceErrors,
      sectionErrors: page.sectionErrors
    },
    tab,
    now
  )
