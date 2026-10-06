import type {
  ApplicationOverview,
  ApplicationPage
} from '../repositories/applications.repository.ts'
import type { RecordTab } from '../repositories/record-page.ts'
import {
  applicationType,
  toApplicationHref
} from './applications-page.view-model.ts'
import { toCaseHref } from './cases-page.view-model.ts'
import {
  toDateFact,
  toMonoFact,
  toRecordPage,
  toSeriesFact,
  toSizeFact,
  toVersionedFact
} from './record-page.view-model.ts'
import type { Fact, RecordPageModel } from './record-page.view-model.ts'

const toFacts = (
  overview: ApplicationOverview,
  clientRef: string
): Fact[][] => [
  [
    toVersionedFact('grant', 'Grant', overview),
    toDateFact('submitted', 'Submitted', overview.submittedAt),
    toDateFact('created', 'Created', overview.createdAt),
    toDateFact('updated', 'Updated', overview.updatedAt)
  ],
  [
    toMonoFact('sbi', 'SBI', overview.identifiers.sbi),
    toMonoFact('frn', 'FRN', overview.identifiers.frn),
    toMonoFact('crn', 'CRN', overview.identifiers.crn),
    toSeriesFact(overview.series, clientRef, (ref) =>
      toApplicationHref({ code: overview.code, clientRef: ref })
    ),
    toSizeFact(overview.storedBytes)
  ]
]

/** A case's ref and workflow are its application's, by construction. */
const toCounterpartHref = ({ header }: ApplicationPage): string | null =>
  header.counterpart?.exists
    ? toCaseHref({ workflowCode: header.code, caseRef: header.clientRef })
    : null

export const toApplicationPage = (
  page: ApplicationPage,
  tab: RecordTab,
  now: Date = new Date()
): RecordPageModel =>
  toRecordPage(
    applicationType,
    {
      ref: page.header.clientRef,
      href: toApplicationHref(page.header),
      position: page.header.position,
      counterpartHref: toCounterpartHref(page),
      facts: page.overview
        ? toFacts(page.overview, page.header.clientRef)
        : null,
      events: page.events,
      raw: page.raw,
      sourceErrors: page.sourceErrors,
      sectionErrors: page.sectionErrors
    },
    tab,
    now
  )
