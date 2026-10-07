import { applicationType } from './applications-page.view-model.ts'
import { caseType } from './cases-page.view-model.ts'
import { toRecordPage, toSeriesData } from './record-page.view-model.ts'
import type { RecordPageData, SeriesMember } from './record-page.view-model.ts'

const now = new Date('2026-09-30T15:17:31.000Z')

const data = (overrides: Partial<RecordPageData> = {}): RecordPageData => ({
  ref: 'f02-7d8-a61',
  href: '/dev-ops/cases/woodland/f02-7d8-a61',
  position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
  facts: null,
  sourceErrors: [],
  sectionErrors: [],
  ...overrides
})

describe('toRecordPage', () => {
  test('names every missed source', () => {
    const page = toRecordPage(
      applicationType,
      data({ sourceErrors: [{ hop: 'CW-BE Cases' }, { hop: 'CW-BE Inbox' }] }),
      'overview',
      now
    )

    expect(page.unavailableSources).toBe('CW-BE Cases, CW-BE Inbox')
  })

  const member = (ref: string): SeriesMember => ({
    ref,
    position: { phase: null, stage: null, status: 'STATUS_IN_REVIEW' },
    createdAt: '2026-09-29T15:02:44.000Z',
    closedAt: null
  })

  const hrefOf = (ref: string) => `/dev-ops/cases/woodland/${ref}`

  const seriesOf = (
    latestRef: string | null,
    refs: string[],
    members?: SeriesMember[]
  ) => toSeriesData({ latestRef, refs, members }, (known) => known, hrefOf)

  test('marks every member but the latest replaced, and links every one but this record', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          '0aa-1bb-2cc',
          ['9d3-5b1-e08', 'f02-7d8-a61', '0aa-1bb-2cc'],
          []
        )
      }),
      'overview',
      now
    )

    expect(
      page.series?.map(({ ref, href, replaced }) => ({ ref, href, replaced }))
    ).toEqual([
      {
        ref: '9d3-5b1-e08',
        href: '/dev-ops/cases/woodland/9d3-5b1-e08',
        replaced: true
      },
      { ref: 'f02-7d8-a61', href: null, replaced: true },
      {
        ref: '0aa-1bb-2cc',
        href: '/dev-ops/cases/woodland/0aa-1bb-2cc',
        replaced: false
      }
    ])
  })

  test('marks no member replaced when GAS names no latest', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(null, ['9d3-5b1-e08', 'f02-7d8-a61'], [])
      }),
      'overview',
      now
    )

    expect(page.series?.map(({ replaced }) => replaced)).toEqual([false, false])
  })

  test('has no series of fewer than two', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['f02-7d8-a61'],
          [member('f02-7d8-a61')]
        )
      }),
      'overview',
      now
    )

    expect(page.series).toBeNull()
  })

  test('keeps a row for a ref GAS sent no member for, with nothing known of it', () => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['9d3-5b1-e08', 'f02-7d8-a61'],
          [member('f02-7d8-a61')]
        )
      }),
      'overview',
      now
    )

    expect(page.seriesDetailed).toBe(true)
    expect(
      page.series?.map(({ ref, statusLabel, created }) => ({
        ref,
        statusLabel,
        created
      }))
    ).toEqual([
      { ref: '9d3-5b1-e08', statusLabel: null, created: null },
      {
        ref: 'f02-7d8-a61',
        statusLabel: 'In review',
        created: {
          text: '1d ago',
          instant: '2026-09-29T15:02:44Z',
          precise: '29 Sep 2026 16:02:44.000',
          clock: '29 Sep 16:02'
        }
      }
    ])
  })

  test.each([
    ['an ISO instant', '2026-09-30T15:10:31.000Z', '7m ago', '16:10:31'],
    [
      'a date only a lenient parser reads',
      '2026-06-16 10:00',
      '2026-06-16 10:00',
      ''
    ],
    ['a date in another shape', '29/09/2026', '29/09/2026', ''],
    ['an empty string', '', '""', '']
  ])('draws %s as the lists do, or as stored', (_, createdAt, text, clock) => {
    const page = toRecordPage(
      caseType,
      data({
        series: seriesOf(
          'f02-7d8-a61',
          ['9d3-5b1-e08', 'f02-7d8-a61'],
          [{ ...member('9d3-5b1-e08'), createdAt }, member('f02-7d8-a61')]
        )
      }),
      'overview',
      now
    )

    expect(page.series?.[0].created).toMatchObject({ text, clock })
  })

  test('lists the refs alone when GAS sent no members at all', () => {
    const page = toRecordPage(
      caseType,
      data({ series: seriesOf('f02-7d8-a61', ['9d3-5b1-e08', 'f02-7d8-a61']) }),
      'overview',
      now
    )

    expect(page.seriesDetailed).toBe(false)
    expect(
      page.series?.map(({ ref, replaced }) => `${ref} ${replaced}`)
    ).toEqual(['9d3-5b1-e08 true', 'f02-7d8-a61 false'])
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
