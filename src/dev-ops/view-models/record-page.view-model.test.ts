import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import { toRecordPage } from './record-page.view-model.ts'
import type { RecordPageData } from './record-page.view-model.ts'

const now = new Date('2026-09-30T15:17:31.000Z')

const data = (overrides: Partial<RecordPageData> = {}): RecordPageData => ({
  ref: 'f02-7d8-a61',
  href: '/dev-ops/cases/woodland/f02-7d8-a61',
  position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
  counterpartHref: null,
  facts: null,
  sourceErrors: [],
  sectionErrors: [],
  ...overrides
})

describe('toRecordPage', () => {
  test('marks the counterpart unknown when its check failed, and leaves that check out of the missed sources', () => {
    const page = toRecordPage(
      applicationType,
      data({ sourceErrors: [{ hop: 'CW-BE Cases' }, { hop: 'CW-BE Inbox' }] }),
      'overview',
      now
    )

    expect(page.counterpartUnknown).toBe(true)
    expect(page.unavailableSources).toBe('CW-BE Inbox')
  })

  test('never marks the counterpart unknown on a type with no check of its own, naming every missed source', () => {
    const page = toRecordPage(
      caseType,
      data({ sourceErrors: [{ hop: 'GAS Applications' }] }),
      'overview',
      now
    )

    expect(page.counterpartUnknown).toBe(false)
    expect(page.unavailableSources).toBe('GAS Applications')
  })

  test('links each tab off the record, marking the open one', () => {
    expect(
      toRecordPage(caseType, data(), 'raw', now).tabs.map(
        ({ href, active }) => `${href} ${active}`
      )
    ).toEqual([
      '/dev-ops/cases/woodland/f02-7d8-a61 false',
      '/dev-ops/cases/woodland/f02-7d8-a61?section=events false',
      '/dev-ops/cases/woodland/f02-7d8-a61?section=raw true'
    ])
  })

  test("tells GAS's too large to show apart from a Raw error", () => {
    const tooLarge = toRecordPage(
      caseType,
      data({
        sectionErrors: [{ section: 'raw', message: 'too large to show' }]
      }),
      'raw',
      now
    )
    const failed = toRecordPage(
      caseType,
      data({ sectionErrors: [{ section: 'raw', message: 'Raw failed' }] }),
      'raw',
      now
    )

    expect(tooLarge).toMatchObject({
      raw: { view: null, tooLarge: true },
      sectionError: null
    })
    expect(failed).toMatchObject({
      raw: { view: null, tooLarge: false },
      sectionError: 'Raw failed'
    })
  })

  test('leaves Raw out on any other tab', () => {
    expect(
      toRecordPage(caseType, data({ raw: { caseRef: 'x' } }), 'overview', now)
        .raw
    ).toBeNull()
  })

  test('links on to the events search when there are more events', () => {
    expect(
      toRecordPage(
        caseType,
        data({ events: { rows: [], more: true } }),
        'events',
        now
      ).events
    ).toEqual({ rows: [], allHref: '/dev-ops/events?q=f02-7d8-a61' })
  })
})
