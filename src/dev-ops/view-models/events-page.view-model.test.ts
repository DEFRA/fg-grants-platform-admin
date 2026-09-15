import { config } from '../../common/config.ts'
import type {
  EventBreakdownGroup,
  EventCounts,
  EventFacets,
  EventRow as EventRowResponse,
  EventService,
  EventsPagination,
  EventsQuery,
  EventsResult,
  ServiceFilter,
  SourceError,
  StatusFilter
} from '../use-cases/get-events.use-case.ts'
import type { EventsPageQuery } from './events-page.view-model.ts'
import { toEventsPage } from './events-page.view-model.ts'

vi.mock(import('../../common/config.ts'))

const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const now = new Date('2026-06-16T10:20:00.000Z')

const event = (
  overrides: Partial<EventRowResponse> = {}
): EventRowResponse => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  status: 'PUBLISHED',
  statusLabel: 'Queued',
  statusRole: 'neutral',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  latency: null,
  latencyTitle: 'Queued to delivered to SNS',
  ...overrides
})

const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Queued',
    explainer: 'Queued, not yet claimed'
  },
  { value: 'PROCESSING', label: 'Processing', explainer: 'Claimed, in flight' },
  { value: 'FAILED', label: 'Failed', explainer: 'Awaiting automatic retry' },
  {
    value: 'RESUBMITTED',
    label: 'Resubmitted',
    explainer: 'Queued for another retry cycle'
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    explainer: 'Processed successfully'
  },
  {
    value: 'DEAD_LETTER',
    label: 'Dead letter',
    explainer: 'Failed all retry attempts; needs a redrive'
  }
]

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'CW-BE' }
]

const pagination = (
  overrides: Partial<EventsPagination> = {}
): EventsPagination => ({
  endCursor: null,
  hasNextPage: false,
  ...overrides
})

const counts = (overrides: Partial<EventCounts> = {}): EventCounts => ({
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 236196,
  DEAD_LETTER: 7064,
  ...overrides
})

const facets = (overrides: Partial<EventCounts> = {}): EventFacets => ({
  counts: counts(overrides)
})

const result = (
  events: EventRowResponse[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
): EventsResult => ({
  page: { events, pagination: pagination(overrides), sourceErrors },
  statuses,
  services,
  facets: facets(),
  breakdown: null,
  unavailable: false
})

const model = (
  events: EventRowResponse[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = [],
  query: EventsQuery = {}
) => toEventsPage(result(events, overrides, sourceErrors), query, now)

const modelFor = (query: EventsQuery, events: EventRowResponse[] = [event()]) =>
  toEventsPage(result(events), query, now)

const rowFor = (overrides: Partial<EventRowResponse> = {}) =>
  model([event(overrides)]).rows[0]

const modelWith = (
  read: EventFacets | null,
  query: EventsQuery = {},
  events: EventRowResponse[] = [event()]
) =>
  toEventsPage(
    {
      page: { events, pagination: pagination(), sourceErrors: [] },
      statuses,
      services,
      facets: read,
      breakdown: null,
      unavailable: false
    },
    query,
    now
  )

const readOut = (chips: { label: string; countLabel?: string | null }[]) =>
  chips.map((chip) =>
    chip.countLabel ? `${chip.label} ${chip.countLabel}` : chip.label
  )

const deadLetter = {
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error' as const,
  statusRetrying: false
}

const storm = (
  minutesAgo: number[],
  overrides: Partial<EventRowResponse> = {}
) =>
  minutesAgo.map((minutes, index) =>
    event({
      id: `storm-${index}`,
      eventId: `storm-${index}`,
      ...deadLetter,
      createdAt: new Date(now.getTime() - minutes * 60 * 1000).toISOString(),
      ...overrides
    })
  )

const statusChips = (query: EventsQuery = {}) =>
  model([event()], {}, [], query).statusFilters

const serviceChips = (query: EventsQuery = {}) =>
  model([event()], {}, [], query).serviceFilters

const labelled = <T extends { label: string }>(chips: T[], label: string) =>
  chips.find((chip) => chip.label === label)

const bothPages = pagination({
  endCursor: 'END',
  hasNextPage: true
})

describe('toEventsPage', () => {
  test('counts seconds for something that has only just happened', () => {
    expect(rowFor({ createdAt: '2026-06-16T10:19:15.000Z' }).createdAt).toBe(
      '45s ago'
    )
  })

  test('counts minutes from a minute old', () => {
    expect(rowFor({ createdAt: '2026-06-16T10:19:00.000Z' }).createdAt).toBe(
      '1m ago'
    )
  })

  test('still counts seconds a second short of a minute', () => {
    expect(rowFor({ createdAt: '2026-06-16T10:19:01.000Z' }).createdAt).toBe(
      '59s ago'
    )
  })

  test('counts minutes for something less than an hour old', () => {
    expect(rowFor({ createdAt: '2026-06-16T09:58:00.000Z' }).createdAt).toBe(
      '22m ago'
    )
  })

  test('carries the spare minutes once it is hours old', () => {
    expect(rowFor({ createdAt: '2026-06-16T07:08:00.000Z' }).createdAt).toBe(
      '3h 12m ago'
    )
  })

  test('counts whole days past a day old', () => {
    expect(rowFor({ createdAt: '2026-06-14T10:20:00.000Z' }).createdAt).toBe(
      '2d ago'
    )
  })

  test('drops the spare hours from a day count', () => {
    expect(rowFor({ createdAt: '2026-06-13T22:20:00.000Z' }).createdAt).toBe(
      '2d ago'
    )
  })

  test('reads a clock skewed into the future as just now', () => {
    expect(rowFor({ createdAt: '2026-06-16T10:30:00.000Z' }).createdAt).toBe(
      '0s ago'
    )
  })

  test('carries only the ISO-UTC instant in the created title', () => {
    expect(
      rowFor({ createdAt: '2026-06-16T10:00:00.000Z' }).createdAtTitle
    ).toBe('2026-06-16T10:00:00Z')
  })

  test('states Greenwich Mean Time on a winter row', () => {
    expect(
      rowFor({ createdAt: '2026-01-16T10:00:00.000Z' }).createdAtTitle
    ).toBe('2026-01-16T10:00:00Z')
  })

  test('shows a dash rather than throwing on an unparseable timestamp', () => {
    const row = rowFor({ createdAt: 'nope' })

    expect(row.createdAt).toBe('-')
    expect(row.createdAtTitle).toBe('')
  })

  test('draws a status in the words the endpoint sent, raw value and all', () => {
    expect(rowFor(deadLetter)).toMatchObject({
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter',
      statusRole: 'error',
      statusRetrying: false
    })
  })

  test('draws a status it has never seen exactly as the endpoint spelled it', () => {
    expect(
      rowFor({
        status: 'QUARANTINED',
        statusLabel: 'QUARANTINED',
        statusRole: 'neutral',
        statusRetrying: false
      })
    ).toMatchObject({
      status: 'QUARANTINED',
      statusLabel: 'QUARANTINED',
      statusRole: 'neutral'
    })
  })

  test('marks a dead letter row, and no other', () => {
    expect(rowFor(deadLetter).isDeadLetter).toBe(true)
    expect(rowFor({ status: 'COMPLETED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'FAILED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'PUBLISHED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'COMPLETED' })).not.toHaveProperty('isCompleted')
  })

  test('says the service and the box in words', () => {
    expect(rowFor()).toMatchObject({ serviceLabel: 'GAS', boxLabel: 'Outbox' })
    expect(rowFor({ service: 'caseworking', box: 'inbox' })).toMatchObject({
      serviceLabel: 'CW-BE',
      boxLabel: 'Inbox'
    })
  })

  test('draws an unknown service or box as the endpoint sent it', () => {
    expect(
      rowFor({
        service: 'reporting' as unknown as EventService,
        box: 'archive' as unknown as EventRowResponse['box']
      })
    ).toMatchObject({ serviceLabel: 'reporting', boxLabel: 'archive' })
  })

  test('names the event under its id', () => {
    const row = rowFor({ type: 'io.onsite.agreement.status.updated' })

    expect(row.eventName).toEqual({
      name: 'AgreementStatusUpdated',
      spoken: 'Agreement status updated'
    })
  })

  test('carries the whole event id, unshortened', () => {
    const row = rowFor({ eventId: '3f2c1a0e-1111-2222-3333-444455556666' })

    expect(row.eventId).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(row).not.toHaveProperty('eventIdShort')
  })

  test('carries the audit label through, with the id still naming the row', () => {
    const row = rowFor({
      eventId: '665f1c2e9a1b2c3d4e5f6a7b',
      type: 'audit'
    })

    expect(row.eventId).toBe('665f1c2e9a1b2c3d4e5f6a7b')
    expect(row.eventName.name).toBe('AuditRecord')
    expect(row).not.toHaveProperty('typeTitle')
  })

  test('puts no segregation reference on a row', () => {
    const row = rowFor()

    expect(row).not.toHaveProperty('segregationRef')
    expect(row).not.toHaveProperty('segregationRefHref')
    expect(row).not.toHaveProperty('segregationRefTitle')
  })

  test('renders every row of a retry storm as its own row', () => {
    const page = model(storm([32, 34, 36, 38]))

    expect(page.rows).toHaveLength(4)
    expect(page).not.toHaveProperty('groups')
  })

  test('renders a run of audit rows as separate rows too', () => {
    const page = model(storm([32, 34], { type: 'audit' }))

    expect(page.rows).toHaveLength(2)
    expect(page.rows.every((row) => row.eventName.name === 'AuditRecord')).toBe(
      true
    )
  })

  test('offers a segment for All and for each status a message passes through', () => {
    expect(statusChips().map((chip) => chip.label)).toEqual([
      'All',
      'Queued',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed',
      'Dead letter'
    ])
  })

  test('links each segment at its own page, keeping the other filters', () => {
    expect(labelled(statusChips({ service: 'gas' }), 'Dead letter')?.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas'
    )
    expect(
      labelled(statusChips({ status: 'DEAD_LETTER' }), 'Dead letter')?.active
    ).toBe(true)
  })

  test('offers a chip for All and for each service', () => {
    expect(serviceChips().map((chip) => chip.label)).toEqual([
      'All',
      'GAS',
      'CW-BE'
    ])
  })

  test('says the caseworking service as CW-BE, and still asks for caseworking', () => {
    const chip = serviceChips().find((option) => option.label === 'CW-BE')

    expect(chip?.value).toBe('caseworking')
    expect(chip?.href).toBe('/dev-ops/events?service=caseworking')
    expect(
      modelFor({}, [event({ service: 'caseworking' })]).rows[0].serviceLabel
    ).toBe('CW-BE')
  })

  test('holds All active on a page opened with no filter', () => {
    expect(labelled(statusChips(), 'All')?.active).toBe(true)
    expect(labelled(serviceChips(), 'All')?.active).toBe(true)
  })

  test('marks the status the page is filtered to, and only that one', () => {
    const chips = statusChips({ status: 'DEAD_LETTER' })

    expect(
      chips.filter((chip) => chip.active).map((chip) => chip.label)
    ).toEqual(['Dead letter'])
  })

  test('marks the service the page is filtered to by its own label', () => {
    const chips = serviceChips({ service: 'caseworking' })

    expect(
      chips.filter((chip) => chip.active).map((chip) => chip.label)
    ).toEqual(['CW-BE'])
  })

  test('leaves the service chips alone when only the status is filtered', () => {
    expect(labelled(serviceChips({ status: 'FAILED' }), 'All')?.active).toBe(
      true
    )
  })

  test('does not call a paged page filtered', () => {
    const chips = statusChips({ cursor: 'END' })

    expect(labelled(chips, 'All')?.active).toBe(true)
  })

  test('holds no chip active for a status it does not offer', () => {
    expect(statusChips({ status: 'QUARANTINED' }).some((c) => c.active)).toBe(
      false
    )
  })

  test('links each status chip at itself, keeping the service filter', () => {
    const chips = statusChips({ service: 'gas' })

    expect(labelled(chips, 'All')?.href).toBe('/dev-ops/events?service=gas')
    expect(labelled(chips, 'Failed')?.href).toBe(
      '/dev-ops/events?status=FAILED&service=gas'
    )
  })

  test('links each service chip at itself, keeping the status filter', () => {
    const chips = serviceChips({ status: 'FAILED' })

    expect(labelled(chips, 'All')?.href).toBe('/dev-ops/events?status=FAILED')
    expect(labelled(chips, 'CW-BE')?.href).toBe(
      '/dev-ops/events?status=FAILED&service=caseworking'
    )
  })

  test('links All at the bare page when nothing else is filtered', () => {
    expect(labelled(statusChips(), 'All')?.href).toBe('/dev-ops/events')
    expect(labelled(serviceChips(), 'All')?.href).toBe('/dev-ops/events')
  })

  test('drops the cursor from every filter link', () => {
    const query = { cursor: 'END', status: 'FAILED' }

    const hrefs = [...statusChips(query), ...serviceChips(query)].map(
      (chip) => chip.href
    )

    expect(hrefs.some((href) => href.includes('cursor'))).toBe(false)
    expect(hrefs.some((href) => href.includes('direction'))).toBe(false)
  })

  test('percent-encodes a filter value on the links it keeps it on', () => {
    expect(labelled(statusChips({ service: 'a b&c' }), 'Failed')?.href).toBe(
      '/dev-ops/events?status=FAILED&service=a+b%26c'
    )
  })

  test('offers no kind chips at all', () => {
    expect(model([event()])).not.toHaveProperty('kindFilters')
  })

  test('keeps the search on every filter link', () => {
    const query = { q: 'gld-9b2' }

    const hrefs = [...statusChips(query), ...serviceChips(query)].map(
      (chip) => chip.href
    )

    expect(hrefs.every((href) => href.includes('q=gld-9b2'))).toBe(true)
  })

  test('reports the search the page was opened with', () => {
    expect(model([event()], {}, [], { q: 'gld-9b2' }).q).toBe('gld-9b2')
  })

  test('trims the search it reports and the links it builds it into', () => {
    const page = model([event()], {}, [], { q: '  gld-9b2  ' })

    expect(page.q).toBe('gld-9b2')
    expect(labelled(page.statusFilters, 'Failed')?.href).toBe(
      '/dev-ops/events?status=FAILED&q=gld-9b2'
    )
  })

  test('reports no search on a page that is not one', () => {
    expect(model([event()]).q).toBeNull()
    expect(model([event()], {}, [], { q: '   ' }).q).toBeNull()
  })

  test('clears the search and keeps every other filter', () => {
    const { clearSearchHref } = model([event()], {}, [], {
      status: 'FAILED',
      service: 'gas',
      q: 'gld-9b2'
    })

    expect(clearSearchHref).toBe('/dev-ops/events?status=FAILED&service=gas')
  })

  test('restates every filter the search form has to carry', () => {
    const { searchFilters } = model([event()], {}, [], {
      cursor: 'END',
      status: 'FAILED',
      service: 'gas',
      q: 'gld-9b2'
    })

    expect(searchFilters).toEqual([
      { name: 'status', value: 'FAILED' },
      { name: 'service', value: 'gas' }
    ])
  })

  test('restates nothing for an unfiltered page', () => {
    expect(model([event()]).searchFilters).toEqual([])
  })

  test('links the next page to the end cursor', () => {
    const page = model([event()], { endCursor: 'END', hasNextPage: true })

    expect(page.nextHref).toBe('/dev-ops/events?cursor=END')
    expect(page).not.toHaveProperty('previousHref')
  })

  test('keeps every filter, and the search, on the next page', () => {
    const { nextHref } = model([event()], bothPages, [], {
      status: 'FAILED',
      service: 'caseworking',
      q: 'gld-9b2'
    })

    expect(nextHref).toBe(
      '/dev-ops/events?cursor=END&status=FAILED&service=caseworking&q=gld-9b2'
    )
  })

  test('offers no next page on the last page', () => {
    const { nextHref } = model([event()], {
      endCursor: 'END',
      hasNextPage: false
    })

    expect(nextHref).toBeNull()
  })

  test('offers no next page when the flag is set but no cursor was issued', () => {
    expect(model([event()], { hasNextPage: true }).nextHref).toBeNull()
  })

  test('percent-encodes a cursor', () => {
    const { nextHref } = model([event()], {
      endCursor: 'a+b/c=',
      hasNextPage: true
    })

    expect(nextHref).toBe('/dev-ops/events?cursor=a%2Bb%2Fc%3D')
  })

  test('names nothing when every source answered', () => {
    expect(model([event()]).unavailableSources).toBe('')
  })

  test('names both CW-BE sources when CW-BE is unconfigured', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        hop: 'CW-BE Inbox'
      },
      {
        hop: 'CW-BE Outbox'
      }
    ])

    expect(unavailableSources).toBe('CW-BE Inbox, CW-BE Outbox')
  })

  test('names a GAS source when one GAS read failed', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        hop: 'GAS Outbox'
      }
    ])

    expect(unavailableSources).toBe('GAS Outbox')
  })

  test('names sources from both services when each lost one', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        hop: 'GAS Inbox'
      },
      {
        hop: 'CW-BE Outbox'
      }
    ])

    expect(unavailableSources).toBe('GAS Inbox, CW-BE Outbox')
  })

  test('leaves markup in an unavailable source name for the template to escape', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        hop: '<script>alert(1)</script> Inbox'
      }
    ])

    expect(unavailableSources).toBe('<script>alert(1)</script> Inbox')
  })

  test('reports the page unavailable when it could not be read', () => {
    const { unavailable, rows } = toEventsPage(
      {
        page: {
          events: [],
          pagination: pagination(),
          sourceErrors: []
        },
        statuses: [],
        services: [],
        facets: null,
        breakdown: null,
        unavailable: true
      },
      {}
    )

    expect(unavailable).toBe(true)
    expect(rows).toHaveLength(0)
  })

  test('puts no trace link and no trace id on a row', () => {
    givenLogsExplorer()

    const row = rowFor()

    expect(row).not.toHaveProperty('traceHref')
    expect(row).not.toHaveProperty('traceId')
  })

  test('reports no count of its own rows', () => {
    const page = model([...storm([30, 32, 34]), event({ id: 'alone' })])

    expect(page).not.toHaveProperty('eventCount')
    expect(page.rows).toHaveLength(4)
  })

  test('counts every status, and All as their sum', () => {
    expect(readOut(statusChips())).toEqual([
      'All 243,260',
      'Queued 0',
      'Processing 0',
      'Failed 0',
      'Resubmitted 0',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
  })

  test('holds every status tile to its own figure on a filtered page', () => {
    const chips = statusChips({ status: 'DEAD_LETTER' })

    expect(chips.map((chip) => chip.countLabel)).toEqual([
      '243,260',
      '0',
      '0',
      '0',
      '0',
      '236,196',
      '7,064'
    ])
  })

  test('lights no tile for a status it has none for', () => {
    const chips = statusChips({ status: 'WEIRD' })

    expect(chips.some((chip) => chip.active)).toBe(false)
    expect(chips[0].countLabel).toBe('243,260')
  })

  test('numbers no tile, All included, when the counts could not be read', () => {
    expect(
      modelWith(null).statusFilters.every((chip) => chip.countLabel === null)
    ).toBe(true)
  })

  test('puts no figure on any service segment', () => {
    expect(readOut(serviceChips())).toEqual(['All', 'GAS', 'CW-BE'])
  })

  test('leaves the service segments unnumbered on a filtered page too', () => {
    const chips = modelWith(facets(), { service: 'gas' }).serviceFilters

    expect(readOut(chips)).toEqual(['All', 'GAS', 'CW-BE'])
    expect(labelled(chips, 'GAS')?.active).toBe(true)
  })

  test('groups the figures the way a reader reads them', () => {
    const chips = statusChips()

    expect(labelled(chips, 'Dead letter')?.countLabel).toBe('7,064')
    expect(labelled(chips, 'Completed')?.countLabel).toBe('236,196')
  })

  test('marks an empty segment as empty, and still links it', () => {
    const chips = statusChips()

    expect(labelled(chips, 'Failed')).toMatchObject({
      countLabel: '0',
      zero: true,
      href: '/dev-ops/events?status=FAILED'
    })
    expect(labelled(chips, 'Dead letter')).toMatchObject({ zero: false })
  })

  test('marks the dead letter count as the one figure worth a colour', () => {
    expect(labelled(statusChips(), 'Dead letter')?.alarming).toBe(true)
    expect(labelled(statusChips(), 'Completed')?.alarming).toBe(false)
    expect(
      labelled(
        modelWith(facets({ DEAD_LETTER: 0 })).statusFilters,
        'Dead letter'
      )?.alarming
    ).toBe(false)
  })

  test('renders every segment as a label alone when the counts failed', () => {
    const page = modelWith(null)

    expect(readOut(page.statusFilters)).toEqual([
      'All',
      'Queued',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed',
      'Dead letter'
    ])
    expect(readOut(page.serviceFilters)).toEqual(['All', 'GAS', 'CW-BE'])
    expect(page.statusFilters.every((chip) => chip.zero === false)).toBe(true)
    expect(page.unavailable).toBe(false)
  })

  test('carries the wire value of every segment but All', () => {
    expect(statusChips().map((chip) => chip.value)).toEqual([
      null,
      'PUBLISHED',
      'PROCESSING',
      'FAILED',
      'RESUBMITTED',
      'COMPLETED',
      'DEAD_LETTER'
    ])
    expect(serviceChips().map((chip) => chip.value)).toEqual([
      null,
      'gas',
      'caseworking'
    ])
  })

  test('explains what each status segment is counting', () => {
    const chips = statusChips()

    expect(labelled(chips, 'Dead letter')).toMatchObject({
      title: 'Failed all retry attempts; needs a redrive'
    })
    expect(labelled(chips, 'All')).toMatchObject({ title: null })
  })

  test('empties both range boxes on a page with no window on it', () => {
    expect(model([event()]).fromInput).toBe('')
    expect(model([event()]).toInput).toBe('')
  })

  test('says the window nowhere but on the time-range button', () => {
    const page = modelFor({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:00.000Z'
    })

    expect(page).not.toHaveProperty('rangeFilter')
    expect(page.timeRange.label).toBe('2026-06-16 09:00 → 2026-06-16 10:00')
  })

  test('holds the range in the spelling the two boxes read', () => {
    const { fromInput, toInput } = modelFor({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:20:30.000Z'
    })

    expect(fromInput).toBe('2026-06-16T09:00:00')
    expect(toInput).toBe('2026-06-16T10:20:30')
  })

  test('hands an unreadable range value back to the box as it stands', () => {
    expect(modelFor({ from: 'last tuesday' }).fromInput).toBe('last tuesday')
  })

  test('keeps the range on every filter link', () => {
    const { statusFilters, serviceFilters } = modelFor({
      from: '2026-06-16T09:00:00.000Z'
    })

    expect(labelled(statusFilters, 'Dead letter')?.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&from=2026-06-16T09%3A00%3A00.000Z'
    )
    expect(labelled(serviceFilters, 'GAS')?.href).toBe(
      '/dev-ops/events?service=gas&from=2026-06-16T09%3A00%3A00.000Z'
    )
  })

  test('draws the latency the endpoint measured, and what it measured', () => {
    expect(
      rowFor({
        status: 'COMPLETED',
        latency: '1.2s',
        latencyTitle: 'Queued to delivered to SNS'
      })
    ).toMatchObject({
      latency: '1.2s',
      latencyTitle: 'Queued to delivered to SNS'
    })
  })

  test('draws no latency for a row the endpoint reports none for', () => {
    expect(rowFor({ latency: null }).latency).toBeNull()
  })

  test.each([
    ['2026-06-16T10:00:00.000Z', '10:00:00'],
    ['2026-06-15T10:20:00.000Z', '10:20:00'],
    ['2026-06-15T10:19:59.000Z', '15 Jun 10:19'],
    ['2026-06-14T08:18:01.000Z', '14 Jun 08:18'],
    ['2025-12-31T00:00:00.000Z', '31 Dec 00:00'],
    ['2026-06-01T08:18:01.000Z', '1 Jun 08:18'],
    ['2025-09-01T08:18:01.000Z', '1 Sep 08:18'],
    ['2026-06-16T10:25:00.000Z', '10:25:00']
  ])('clocks a row created at %s as %s', (createdAt, clock) => {
    expect(rowFor({ createdAt }).createdAtClock).toBe(clock)
  })

  test('carries no copy value for the clock', () => {
    expect(
      rowFor({ createdAt: '2026-06-14T08:18:01.250Z' })
    ).not.toHaveProperty('createdAtValue')
  })

  test('draws no clock for an instant it cannot read', () => {
    expect(rowFor({ createdAt: 'never' }).createdAtClock).toBe('')
  })

  test('threads no reload parameter through its links or its hidden fields', () => {
    const model = modelFor({
      status: 'FAILED',
      live: '30'
    } as EventsQuery & { live: string })

    expect(model).not.toHaveProperty('live')
    expect(model).not.toHaveProperty('liveHref')
    expect(model).not.toHaveProperty('liveLabel')
    expect(model).not.toHaveProperty('liveSeconds')
    expect(labelled(model.statusFilters, 'Failed')?.href).toBe(
      '/dev-ops/events?status=FAILED'
    )
    expect(model.searchFilters).toEqual([{ name: 'status', value: 'FAILED' }])
  })
})

const group = (
  overrides: Partial<EventBreakdownGroup> = {}
): EventBreakdownGroup => ({
  error: 'E11000 duplicate key error collection: gas.events index: eventId_1',
  type: 'case.status.updated',
  count: 4182,
  firstAt: '2026-06-15T10:20:00.000Z',
  lastAt: '2026-06-16T10:16:05.000Z',
  ...overrides
})

const withBreakdown = (
  query: EventsQuery = { status: 'DEAD_LETTER' },
  groups: EventBreakdownGroup[] = [group()],
  countOverrides: Partial<EventCounts> = {}
) =>
  toEventsPage(
    {
      page: {
        events: [event(deadLetter)],
        pagination: pagination(),
        sourceErrors: []
      },
      statuses,
      services,
      facets: facets(countOverrides),
      breakdown: { groups },
      unavailable: false
    },
    query,
    now
  )

describe('the top failures panel', () => {
  test('carries no open state, on a dead-letter page or an unfiltered one', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }).topFailures

    expect(panel?.summary).toBe('Top errors (1 group)')
    expect(panel).not.toHaveProperty('open')
    expect(withBreakdown({}).topFailures).not.toHaveProperty('open')
  })

  test("names each group's type as the rows name it", () => {
    const [named] = withBreakdown({ status: 'DEAD_LETTER' }, [
      group({ type: 'audit' })
    ]).topFailures!.groups

    expect(named).toMatchObject({
      type: 'audit',
      eventName: { name: 'AuditRecord', spoken: 'Audit record' }
    })
  })

  test('counts its groups in the summary', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }, [
      group(),
      group({ error: 'connection timed out', count: 12 })
    ]).topFailures

    expect(panel?.summary).toBe('Top errors (2 groups)')
    expect(panel?.groups).toHaveLength(2)
  })

  test('is absent when the breakdown reported no groups', () => {
    expect(withBreakdown({ status: 'DEAD_LETTER' }, []).topFailures).toBeNull()
  })

  test('is absent when the breakdown could not be read at all', () => {
    expect(modelFor({ status: 'DEAD_LETTER' }).topFailures).toBeNull()
  })

  test('draws the panel on an unfiltered page whose counts could not be read', () => {
    const page = toEventsPage(
      {
        page: { events: [event()], pagination: pagination(), sourceErrors: [] },
        statuses,
        services,
        facets: null,
        breakdown: { groups: [group()] },
        unavailable: false
      },
      {},
      now
    )

    expect(page.statusFilters.every((chip) => chip.countLabel === null)).toBe(
      true
    )
    expect(page.topFailures?.groups).toHaveLength(1)
  })

  test('trusts the breakdown over a count that says there are none', () => {
    expect(
      withBreakdown({}, [group()], { DEAD_LETTER: 0 }).topFailures?.groups
    ).toHaveLength(1)
  })

  test.each([['COMPLETED'], ['FAILED'], ['PUBLISHED']])(
    'is absent on a page filtered to %s',
    (status) => {
      expect(withBreakdown({ status }).topFailures).toBeNull()
    }
  )

  test('says what each failure is, how many, and over how long', () => {
    const [row] = withBreakdown().topFailures?.groups ?? []

    expect(row.message).toBe(
      'E11000 duplicate key error collection: gas.events index: eventId_1'
    )
    expect(row.type).toBe('case.status.updated')
    expect(row.countLabel).toBe('4,182')
    expect(row.firstAt).toBe('1d ago')
    expect(row.lastAt).toBe('4m ago')
  })

  test('dashes a group instant the breakdown did not record', () => {
    const [row] =
      withBreakdown({ status: 'DEAD_LETTER' }, [
        group({ firstAt: null, lastAt: null })
      ]).topFailures?.groups ?? []

    expect([row.firstAt, row.firstTitle, row.lastAt]).toEqual(['-', '', '-'])
  })

  test('cuts a long message to the width of a line, keeping the whole of it', () => {
    const long = `${'x'.repeat(120)}!`
    const [row] =
      withBreakdown({}, [group({ error: long })]).topFailures?.groups ?? []

    expect(row.message).toBe(`${'x'.repeat(90)}…`)
    expect(row.messageTitle).toBe(long)
    expect(row.href).toContain(new URLSearchParams({ error: long }).toString())
  })

  test('narrows the page to one failure, keeping every other filter', () => {
    const [row] =
      withBreakdown({
        status: 'DEAD_LETTER',
        service: 'gas',
        q: 'gld-9b2',
        from: '2026-06-16T09:00:00.000Z',
        to: '2026-06-16T10:00:00.000Z',
        cursor: 'END'
      }).topFailures?.groups ?? []

    expect(row.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+eventId_1&from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('drops the cursor from the link', () => {
    const [row] = withBreakdown({ cursor: 'END' }).topFailures?.groups ?? []

    expect(row.href).not.toContain('cursor')
    expect(row.href).not.toContain('direction')
  })

  test('names a group with no error a dash, and links it nowhere', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }, [
      group({ error: null, count: 12 })
    ]).topFailures
    const [row] = panel?.groups ?? []

    expect(row.message).toBe('—')
    expect(row.messageTitle).toBeNull()
    expect(row.href).toBeNull()
    expect(panel).not.toHaveProperty('hasUnattributed')
  })
})

describe('the failure filter', () => {
  const message = 'E11000 duplicate key error collection: gas.events'

  test('says which failure the page is narrowed to', () => {
    const { errorFilter } = modelFor({ status: 'DEAD_LETTER', error: message })

    expect(errorFilter?.label).toBe(message)
    expect(errorFilter?.title).toBe(message)
  })

  test('cuts a long message to sixty characters, keeping the whole on the title', () => {
    const long = 'y'.repeat(200)
    const { errorFilter } = modelFor({ error: long })

    expect(errorFilter?.label).toBe(`${'y'.repeat(60)}…`)
    expect(errorFilter?.title).toBe(long)
  })

  test('offers the way out of it, keeping every other filter', () => {
    const { errorFilter } = modelFor({
      status: 'DEAD_LETTER',
      service: 'gas',
      error: message,
      cursor: 'END'
    })

    expect(errorFilter?.clearHref).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas'
    )
  })

  test('is absent on a page that is not narrowed to a failure', () => {
    expect(modelFor({ status: 'DEAD_LETTER' }).errorFilter).toBeNull()
  })

  test('is carried on every filter link', () => {
    const { statusFilters, serviceFilters } = modelFor({ error: message })

    for (const chips of [statusFilters, serviceFilters]) {
      expect(labelled(chips, 'All')?.href).toContain(
        `error=${encodeURIComponent(message).replace(/%20/g, '+')}`
      )
    }
  })

  test('is carried on the pager', () => {
    const { nextHref } = toEventsPage(
      result([event()], { hasNextPage: true, endCursor: 'END' }),
      { error: message },
      now
    )

    expect(nextHref).toContain('error=')
  })

  test('is restated as a hidden field on the search form', () => {
    const { searchFilters } = modelFor({
      status: 'DEAD_LETTER',
      error: message
    })

    expect(searchFilters).toContainEqual({ name: 'error', value: message })
  })

  test('is carried on every filter segment', () => {
    const chips = [
      ...statusChips({ error: message }),
      ...serviceChips({ error: message })
    ]

    expect(chips.every((chip) => chip.href.includes('error='))).toBe(true)
  })
})

describe('the time range control', () => {
  const timeRangeFor = (query: EventsPageQuery = {}) =>
    modelFor(query).timeRange

  test('offers the ladder an operator actually climbs, plus All', () => {
    expect(timeRangeFor().presets.map(({ label }) => label)).toEqual([
      'Last 15m',
      'Last 1h',
      'Last 6h',
      'Last 24h',
      'Last 7d',
      'Last 30d'
    ])
  })

  test('asks for the window ending now, counted from the render', () => {
    const byKey = Object.fromEntries(
      timeRangeFor().presets.map((preset) => [preset.key, preset.href])
    )

    expect(byKey['15m']).toBe(
      '/dev-ops/events?from=2026-06-16T10%3A05%3A00.000Z&range=15m'
    )
    expect(byKey['1h']).toBe(
      '/dev-ops/events?from=2026-06-16T09%3A20%3A00.000Z&range=1h'
    )
    expect(byKey['24h']).toBe(
      '/dev-ops/events?from=2026-06-15T10%3A20%3A00.000Z&range=24h'
    )
    expect(byKey['7d']).toBe(
      '/dev-ops/events?from=2026-06-09T10%3A20%3A00.000Z&range=7d'
    )
  })

  test('keeps every other filter and clears the end of the range', () => {
    const [fifteen] = timeRangeFor({
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      to: '2026-06-16T10:00:00.000Z',
      cursor: 'END'
    }).presets

    expect(fifteen.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2&from=2026-06-16T10%3A05%3A00.000Z&range=15m'
    )
  })

  test('clears the window, and its label with it, on All', () => {
    const range = timeRangeFor({
      status: 'DEAD_LETTER',
      from: '2026-06-15T10:20:00.000Z',
      range: '24h',
      cursor: 'END'
    })

    expect(range.anyTimeHref).toBe('/dev-ops/events?status=DEAD_LETTER')
  })

  test('says All on a page with no window on it', () => {
    const range = timeRangeFor()

    expect(range.label).toBe('All')
    expect(range.active).toBe(false)
    expect(range.anyTimeActive).toBe(true)
  })

  test('says Last 24h back on the page a Last 24h link opens', () => {
    const range = timeRangeFor({
      from: '2026-06-15T10:19:57.000Z',
      range: '24h'
    })

    expect(range.label).toBe('Last 24h')
    expect(range.active).toBe(true)
    expect(range.anyTimeActive).toBe(false)
  })

  test('marks the rung the page is standing on, and only that one', () => {
    const active = timeRangeFor({
      from: '2026-06-15T10:19:57.000Z',
      range: '24h'
    }).presets.filter((preset) => preset.active)

    expect(active.map((preset) => preset.key)).toEqual(['24h'])
  })

  test('says the window as a pair when it was typed rather than picked', () => {
    expect(
      timeRangeFor({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z'
      }).label
    ).toBe('2026-09-01 00:00 → 2026-09-02 00:00')
  })

  test('names an open end rather than leaving it blank', () => {
    expect(timeRangeFor({ from: '2026-09-01T00:00:00.000Z' }).label).toBe(
      '2026-09-01 00:00 → now'
    )
    expect(timeRangeFor({ to: '2026-09-02T00:00:00.000Z' }).label).toBe(
      'earliest → 2026-09-02 00:00'
    )
  })

  test('ignores a range label that does not fit the window it names', () => {
    expect(
      timeRangeFor({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
        range: '24h'
      }).label
    ).toBe('2026-09-01 00:00 → 2026-09-02 00:00')

    expect(timeRangeFor({ range: '24h' }).label).toBe('All')
    expect(
      timeRangeFor({ from: '2026-09-01T00:00:00.000Z', range: 'nonsense' })
        .label
    ).toBe('2026-09-01 00:00 → now')
  })

  test('puts the label on the button title too', () => {
    expect(timeRangeFor().title).toBe('Time range: All')
  })
})

describe('the audit population', () => {
  test('is a switch named Show audit events', () => {
    const { showAudit } = modelFor({})

    expect(showAudit.label).toBe('Show audit events')
    expect(showAudit.title).toBe('Show audit events alongside the queue')
  })

  test('is off on a page that did not ask for it', () => {
    expect(modelFor({}).showAudit.checked).toBe(false)
  })

  test('is on on a page that asked for it', () => {
    const { showAudit } = modelFor({ audit: 'include' })

    expect(showAudit.checked).toBe(true)
    expect(showAudit.title).toBe('Hide audit events: the queue alone')
  })

  test('links to the opposite state', () => {
    expect(modelFor({}).showAudit.href).toBe('/dev-ops/events?audit=include')
    expect(modelFor({ audit: 'include' }).showAudit.href).toBe(
      '/dev-ops/events'
    )
  })

  test('keeps every other filter, and drops the cursor, on its link', () => {
    const query = {
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      cursor: 'END'
    }

    expect(modelFor(query).showAudit.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&audit=include&q=gld-9b2'
    )
    expect(modelFor({ ...query, audit: 'include' }).showAudit.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2'
    )
  })

  test('rides the other filter links and both forms', () => {
    const page = modelFor({ audit: 'include' })

    expect(
      page.statusFilters.every((chip) => chip.href.includes('audit=include'))
    ).toBe(true)
    expect(
      page.serviceFilters.every((chip) => chip.href.includes('audit=include'))
    ).toBe(true)
    expect(page.searchFilters).toContainEqual({
      name: 'audit',
      value: 'include'
    })
    expect(page.rangeFilters).toContainEqual({
      name: 'audit',
      value: 'include'
    })
  })
})

describe('the statuses the toolbar offers', () => {
  test('ends at Dead letter, with no Parked segment', () => {
    expect(statusChips().map((chip) => chip.value)).toEqual([
      null,
      'PUBLISHED',
      'PROCESSING',
      'FAILED',
      'RESUBMITTED',
      'COMPLETED',
      'DEAD_LETTER'
    ])
  })
})

describe('the count chips explain themselves', () => {
  test.each([
    ['DEAD_LETTER', 'Failed all retry attempts; needs a redrive'],
    ['FAILED', 'Awaiting automatic retry'],
    ['RESUBMITTED', 'Queued for another retry cycle'],
    ['PROCESSING', 'Claimed, in flight'],
    ['PUBLISHED', 'Queued, not yet claimed'],
    ['COMPLETED', 'Processed successfully']
  ])('says what %s means', (status, explainer) => {
    const chip = statusChips().find((candidate) => candidate.value === status)

    expect(chip?.title).toBe(explainer)
  })
})
