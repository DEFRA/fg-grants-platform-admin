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
import type { EventsPageQuery, FilterChip } from './events-page.view-model.ts'
import { toEventsPage } from './events-page.view-model.ts'

vi.mock(import('../../common/config.ts'))

const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

/**
 * The feature is off until a base url is configured, so every trace assertion
 * turns it on for itself. `clearMocks` wipes the write between tests.
 */
const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

/**
 * The clock the page is rendered against; every relative time below is an
 * offset from it.
 */
const now = new Date('2026-06-16T10:20:00.000Z')

/**
 * One row exactly as fg-gas-backend sends it: every word already spelled, so
 * these tests exercise what this app still decides — the instants against the
 * clock, the links, and the truncation.
 */
const event = (
  overrides: Partial<EventRowResponse> = {}
): EventRowResponse => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  hop: 'GAS Outbox',
  queue: 'to Caseworking',
  queueValue: 'gas__sns__update_case_status_fifo',
  status: 'PUBLISHED',
  statusLabel: 'Published',
  statusRole: 'neutral',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: null,
  latency: null,
  latencyTitle: 'Queued to delivered to SNS',
  ...overrides
})

const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Published',
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
  { value: 'caseworking', label: 'Caseworking' }
]

const pagination = (
  overrides: Partial<EventsPagination> = {}
): EventsPagination => ({
  startCursor: null,
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: false,
  ...overrides
})

/** Every status always present, zero included. */
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

/** The same page, asked with a query, when the query is the point. */
const modelFor = (query: EventsQuery, events: EventRowResponse[] = [event()]) =>
  toEventsPage(result(events), query, now)

const rowFor = (overrides: Partial<EventRowResponse> = {}) =>
  model([event(overrides)]).rows[0]

/** The same page with facets of its own — or none, a failed counts read. */
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

/** What a segment says, as it is read: the word, then the figure. */
const readOut = (chips: FilterChip[]) =>
  chips.map((chip) =>
    chip.countLabel === null ? chip.label : `${chip.label} ${chip.countLabel}`
  )

/** A retry storm: identical rows minutes apart, one row per attempt. */
/** The state a row is in when it has failed every attempt it was allowed. */
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

const labelled = (chips: FilterChip[], label: string) =>
  chips.find((chip) => chip.label === label)

const bothPages = pagination({
  startCursor: 'START',
  endCursor: 'END',
  hasNextPage: true,
  hasPreviousPage: true
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

  // The relative time is unquotable and, on a tab left open, a lie: the title
  // carries the instant a developer greps for.
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

  // The words are the endpoint's; the raw value travels beside them because
  // `?status=` and a log query take the enum, not the sentence.
  test('draws a status in the words the endpoint sent, raw value and all', () => {
    expect(rowFor(deadLetter)).toMatchObject({
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter',
      statusRole: 'error',
      statusRetrying: false
    })
  })

  // The endpoint passes a status through as written so one unexpected document
  // cannot fail the whole page, and it labels the unknown one as it spelled it.
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

  // The tint the template hangs off this flag is the only saturated thing on
  // a calm page.
  test('marks a dead letter row, and no other', () => {
    expect(rowFor(deadLetter).isDeadLetter).toBe(true)
    expect(rowFor({ status: 'COMPLETED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'FAILED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'PUBLISHED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'COMPLETED' })).not.toHaveProperty('isCompleted')
  })

  test('draws the hop the endpoint named over the queue it named', () => {
    expect(rowFor()).toMatchObject({
      hop: 'GAS Outbox',
      queue: 'to Caseworking',
      queueValue: 'gas__sns__update_case_status_fifo'
    })
  })

  // An inbox row names its producer rather than a topic; nothing to copy.
  test('draws an inbox row as a message it received from somewhere', () => {
    expect(
      rowFor({
        box: 'inbox',
        hop: 'GAS Inbox',
        queue: 'from Caseworking',
        queueValue: null
      })
    ).toMatchObject({
      hop: 'GAS Inbox',
      queue: 'from Caseworking',
      queueValue: null
    })
  })

  // An outbox row that names no target has no second line at all, rather than
  // a line saying `-` twenty times down a page.
  test('draws no queue line where the endpoint sent none', () => {
    expect(rowFor({ queue: null, queueValue: null }).queue).toBeNull()
  })

  // The hop is plain text here. The service filter is the toolbar's job, and
  // this page's own model no longer computes a link no row draws — the detail
  // page's Queue fact still has one, and event-page.view-model.test.ts holds
  // both that and the words the two surfaces share.
  test('hangs no link on the hop', () => {
    const row = rowFor()

    expect(row).not.toHaveProperty('hopHref')
    expect(row).not.toHaveProperty('hopTitle')
  })

  test('draws the hop in the words the endpoint sent', () => {
    expect(rowFor().hop).toBe('GAS Outbox')
    expect(
      rowFor({
        service: 'reporting' as unknown as EventService,
        hop: 'reporting Outbox'
      }).hop
    ).toBe('reporting Outbox')
  })

  test('carries the whole event id, unshortened', () => {
    const row = rowFor({ eventId: '3f2c1a0e-1111-2222-3333-444455556666' })

    expect(row.eventId).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(row).not.toHaveProperty('eventIdShort')
  })

  // An audit record has no type of its own; fg-gas-backend labels it and this
  // model passes the label straight through — nothing is synthesised here.
  test('carries the audit label through, with the id still naming the row', () => {
    const row = rowFor({
      eventId: '665f1c2e9a1b2c3d4e5f6a7b',
      type: 'audit'
    })

    expect(row.eventId).toBe('665f1c2e9a1b2c3d4e5f6a7b')
    expect(row.type).toBe('audit')
    expect(row).not.toHaveProperty('typeTitle')
  })

  test('shows the type the endpoint spells, exactly as it stands', () => {
    expect(rowFor().type).toBe('case.status.updated')
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
    expect(page.rows.every((row) => row.type === 'audit')).toBe(true)
  })

  // Sentence case, like the badges; the raw enum stays on the href.
  test('offers a segment for All and for each status a message passes through', () => {
    expect(statusChips().map((chip) => chip.label)).toEqual([
      'All',
      'Published',
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
      'Caseworking'
    ])
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
    ).toEqual(['Caseworking'])
  })

  test('leaves the service chips alone when only the status is filtered', () => {
    expect(labelled(serviceChips({ status: 'FAILED' }), 'All')?.active).toBe(
      true
    )
  })

  // A cursor is a position, not a filter: page two of the whole stream is
  // still the whole stream.
  test('does not call a paged page filtered', () => {
    const chips = statusChips({ cursor: 'END', direction: 'forward' })

    expect(labelled(chips, 'All')?.active).toBe(true)
  })

  // A `?status=` typed by hand reaches the endpoint untouched, so the honest
  // answer is that the page is filtered to none of the chips — All included.
  test('holds no chip active for a status it does not offer', () => {
    expect(statusChips({ status: 'QUARANTINED' }).some((c) => c.active)).toBe(
      false
    )
  })

  // The label is humanised; the value on the link is not. `?status=` is the
  // endpoint's parameter, and it takes the enum the endpoint wrote.
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
    expect(labelled(chips, 'Caseworking')?.href).toBe(
      '/dev-ops/events?status=FAILED&service=caseworking'
    )
  })

  test('links All at the bare page when nothing else is filtered', () => {
    expect(labelled(statusChips(), 'All')?.href).toBe('/dev-ops/events')
    expect(labelled(serviceChips(), 'All')?.href).toBe('/dev-ops/events')
  })

  test('drops the cursor and direction from every filter link', () => {
    const query = { cursor: 'END', direction: 'forward', status: 'FAILED' }

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

  // Narrowing by status while holding a reference must not drop the
  // reference: the search is a filter like any other.
  test('keeps the search on every filter link', () => {
    const query = { q: 'gld-9b2' }

    const hrefs = [...statusChips(query), ...serviceChips(query)].map(
      (chip) => chip.href
    )

    expect(hrefs.every((href) => href.includes('q=gld-9b2'))).toBe(true)
  })

  test('puts no kind on any filter link', () => {
    const hrefs = [...statusChips({ q: 'x' }), ...serviceChips({ q: 'x' })].map(
      (chip) => chip.href
    )

    expect(hrefs.some((href) => href.includes('kind='))).toBe(false)
  })

  test('reports the search the page was opened with', () => {
    expect(model([event()], {}, [], { q: 'gld-9b2' }).q).toBe('gld-9b2')
  })

  // Trimmed once, here: the chip, the clear link and the empty state all quote
  // it back, and ` gld-9b2 ` quoted with its spaces reads as a different
  // search from the one the operator typed.
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
      direction: 'forward',
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

  test('links Next to the end cursor', () => {
    const { nextHref } = model([event()], {
      endCursor: 'END',
      hasNextPage: true
    })

    expect(nextHref).toBe('/dev-ops/events?cursor=END&direction=forward')
  })

  test('links Previous to the start cursor', () => {
    const { previousHref } = model([event()], {
      startCursor: 'START',
      hasPreviousPage: true
    })

    expect(previousHref).toBe('/dev-ops/events?cursor=START&direction=backward')
  })

  test('keeps the status filter on both links', () => {
    const { previousHref, nextHref } = model([event()], bothPages, [], {
      status: 'DEAD_LETTER'
    })

    expect(previousHref).toBe(
      '/dev-ops/events?cursor=START&direction=backward&status=DEAD_LETTER'
    )
    expect(nextHref).toBe(
      '/dev-ops/events?cursor=END&direction=forward&status=DEAD_LETTER'
    )
  })

  test('keeps the service filter on both links', () => {
    const { previousHref, nextHref } = model([event()], bothPages, [], {
      service: 'gas'
    })

    expect(previousHref).toBe(
      '/dev-ops/events?cursor=START&direction=backward&service=gas'
    )
    expect(nextHref).toBe(
      '/dev-ops/events?cursor=END&direction=forward&service=gas'
    )
  })

  test('keeps both filters on the links', () => {
    const { nextHref } = model([event()], bothPages, [], {
      status: 'FAILED',
      service: 'caseworking'
    })

    expect(nextHref).toBe(
      '/dev-ops/events?cursor=END&direction=forward&status=FAILED&service=caseworking'
    )
  })

  test('offers no Previous link on the first page', () => {
    const { previousHref } = model([event()], {
      startCursor: 'START',
      hasPreviousPage: false
    })

    expect(previousHref).toBeNull()
  })

  test('offers no Next link on the last page', () => {
    const { nextHref } = model([event()], {
      endCursor: 'END',
      hasNextPage: false
    })

    expect(nextHref).toBeNull()
  })

  test('offers no link when a flag is set but no cursor was issued', () => {
    const { previousHref, nextHref } = model([event()], {
      hasNextPage: true,
      hasPreviousPage: true
    })

    expect(previousHref).toBeNull()
    expect(nextHref).toBeNull()
  })

  test('percent-encodes a cursor', () => {
    const { nextHref } = model([event()], {
      endCursor: 'a+b/c=',
      hasNextPage: true
    })

    expect(nextHref).toBe(
      '/dev-ops/events?cursor=a%2Bb%2Fc%3D&direction=forward'
    )
  })

  test('keeps the service and the search on both links', () => {
    const { previousHref, nextHref } = toEventsPage(
      {
        page: { events: [event()], pagination: bothPages, sourceErrors: [] },
        statuses,
        services,
        facets: facets(),
        breakdown: null,
        unavailable: false
      },
      { service: 'gas', q: 'gld-9b2' },
      now
    )

    expect(nextHref).toBe(
      '/dev-ops/events?cursor=END&direction=forward&service=gas&q=gld-9b2'
    )
    expect(previousHref).toBe(
      '/dev-ops/events?cursor=START&direction=backward&service=gas&q=gld-9b2'
    )
  })

  test('names nothing when every source answered', () => {
    expect(model([event()]).unavailableSources).toBe('')
  })

  test('names both Caseworking sources when Caseworking is unconfigured', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: 'caseworking',
        box: 'inbox',
        hop: 'CW Inbox',
        message: 'not configured'
      },
      {
        service: 'caseworking',
        box: 'outbox',
        hop: 'CW Outbox',
        message: 'not configured'
      }
    ])

    expect(unavailableSources).toBe('CW Inbox, CW Outbox')
  })

  test('names a GAS source when one GAS read failed', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: 'gas',
        box: 'outbox',
        hop: 'GAS Outbox',
        message: 'read error'
      }
    ])

    expect(unavailableSources).toBe('GAS Outbox')
  })

  test('names sources from both services when each lost one', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: 'gas',
        box: 'inbox',
        hop: 'GAS Inbox',
        message: 'read error'
      },
      {
        service: 'caseworking',
        box: 'outbox',
        hop: 'CW Outbox',
        message: 'timeout'
      }
    ])

    expect(unavailableSources).toBe('GAS Inbox, CW Outbox')
  })

  // The banner is built from the endpoint's own service/box strings, so a
  // hostile one reaches a template. Escaping is nunjucks' job; this pins that
  // the model hands the value over raw rather than pre-rendering markup.
  test('leaves markup in an unavailable source name for the template to escape', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: '<script>alert(1)</script>' as unknown as EventService,
        box: 'inbox',
        hop: '<script>alert(1)</script> Inbox',
        message: 'timeout'
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
        // A page that could not be read draws no chips, so there is no
        // vocabulary to label them with either.
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

  // Each status segment says how many events *selecting it* would find.
  // `All` deliberately carries no figure — the total is stated over the table.
  test('counts every status segment but All', () => {
    expect(readOut(statusChips())).toEqual([
      'All',
      'Published 0',
      'Processing 0',
      'Failed 0',
      'Resubmitted 0',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
  })

  // The segments are a facet and stay one: the counts endpoint refuses
  // `status` outright, so each keeps saying what selecting it would find even
  // while another is selected.
  test('holds every status segment to its own figure on a filtered page', () => {
    const chips = statusChips({ status: 'DEAD_LETTER' })
    const [all, ...rest] = chips.map((chip) => chip.countLabel)

    expect(all).toBeNull()
    expect(rest).toEqual(['0', '0', '0', '0', '236,196', '7,064'])
  })

  // ── The total ───────────────────────────────────────────────────────────

  // The number an operator reads as "what am I looking at?", and the whole
  // reason it left the All segment: it has to move when any filter moves.
  test('totals the whole filtered set when no status is selected', () => {
    expect(modelFor({}).eventsTotal).toBe('243,260 events')
  })

  test('narrows to the selected status, unlike the segments themselves', () => {
    expect(modelFor({ status: 'DEAD_LETTER' }).eventsTotal).toBe('7,064 events')
    expect(modelFor({ status: 'COMPLETED' }).eventsTotal).toBe('236,196 events')
    expect(modelFor({ status: 'FAILED' }).eventsTotal).toBe('0 events')
  })

  test('says one event in the singular', () => {
    expect(
      modelWith(facets({ FAILED: 1, COMPLETED: 0, DEAD_LETTER: 0 }), {
        status: 'FAILED'
      }).eventsTotal
    ).toBe('1 event')
  })

  // A `?status=` the page has no segment for counts as none of them, which is
  // the same answer the toolbar gives it.
  test('counts a status it has no segment for as none of them', () => {
    expect(modelFor({ status: 'WEIRD' }).eventsTotal).toBe('0 events')
  })

  // The table below is a perfectly good table without a figure over it.
  test('says nothing at all when the counts could not be read', () => {
    expect(modelWith(null).eventsTotal).toBeNull()
  })

  // The service segments are plain labels; the status row is where the arithmetic belongs.
  test('puts no figure on any service segment', () => {
    expect(readOut(serviceChips())).toEqual(['All', 'GAS', 'Caseworking'])
    expect(serviceChips().every((chip) => chip.countLabel === null)).toBe(true)
  })

  test('leaves the service segments unnumbered on a filtered page too', () => {
    const chips = modelWith(facets(), { service: 'gas' }).serviceFilters

    expect(readOut(chips)).toEqual(['All', 'GAS', 'Caseworking'])
    expect(labelled(chips, 'GAS')?.active).toBe(true)
  })

  // A segment with no figure is not an empty one: `zero` drives the dimming,
  // and dimming a label that never had a number would read as "none of these".
  test('dims no service segment, having no count to be zero', () => {
    expect(serviceChips().every((chip) => chip.zero === false)).toBe(true)
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

  // A summary that could not be read has not made the filters below it an error.
  test('renders every segment as a label alone when the counts failed', () => {
    const page = modelWith(null)

    expect(readOut(page.statusFilters)).toEqual([
      'All',
      'Published',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed',
      'Dead letter'
    ])
    expect(readOut(page.serviceFilters)).toEqual(['All', 'GAS', 'Caseworking'])
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

  test('explains what each status segment is counting, and nothing else', () => {
    const chips = statusChips()

    expect(labelled(chips, 'Dead letter')).toMatchObject({
      title: 'Failed all retry attempts; needs a redrive'
    })
    expect(labelled(chips, 'All')).toMatchObject({ title: null })
    expect(labelled(serviceChips(), 'GAS')).toMatchObject({ title: null })
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

  // The boxes read and write a local wall clock; the query carries an instant.
  // This is the only place that knows the two are different spellings.
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

  // The span is measured where the two instants are — receipt for an inbox
  // row, queueing for an outbox one — so the figure and the sentence naming
  // its ends both arrive stated.
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

  // A row from today draws the time alone; the page filtered to Dead letter
  // is exactly the page whose rows are days old, and a bare clock lies there.
  test.each([
    // now is 2026-06-16T10:20:00Z.
    ['2026-06-16T10:00:00.000Z', '10:00:00'],
    // Exactly a day old is still the clock; a second past it takes the date.
    ['2026-06-15T10:20:00.000Z', '10:20:00'],
    ['2026-06-15T10:19:59.000Z', '15 Jun 10:19'],
    ['2026-06-14T08:18:01.000Z', '14 Jun 08:18'],
    // Across a year boundary the date still places it; the year is on the
    // title and on the clipboard, where a value that has to be exact belongs.
    ['2025-12-31T00:00:00.000Z', '31 Dec 00:00'],
    // A single-digit day is not padded, and the month is three letters even in
    // September, which `en-GB` alone spells `Sept`.
    ['2026-06-01T08:18:01.000Z', '1 Jun 08:18'],
    ['2025-09-01T08:18:01.000Z', '1 Sep 08:18'],
    // An instant ahead of the clock is not an old row: it keeps the time.
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

/**
 * The dead letters behind the filters, grouped by the failure that caused them,
 * as the breakdown endpoint reports them: count descending, at most twenty, and
 * `error` null on the ones that recorded no message.
 */
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

/** A page with a breakdown behind it, asked under the given query. */
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
      breakdown: { groups, sourceErrors: [] },
      unavailable: false
    },
    query,
    now
  )

describe('the top failures panel', () => {
  // A queue with seven thousand dead letters in it is not seven thousand
  // incidents. It is usually three, and the list — one keyset window, ordered
  // by time — is the one view that cannot say which three.
  test('opens on a page that is already about dead letters', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }).topFailures

    expect(panel?.open).toBe(true)
    expect(panel?.summary).toBe('Top errors (1 group)')
  })

  test('is folded shut on an unfiltered page with dead letters behind it', () => {
    const panel = withBreakdown({}).topFailures

    expect(panel?.open).toBe(false)
  })

  test('counts its groups in the summary', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }, [
      group(),
      group({ error: 'connection timed out', count: 12 })
    ]).topFailures

    expect(panel?.summary).toBe('Top errors (2 groups)')
    expect(panel?.count).toBe(2)
  })

  // Nothing to summarise is silence, not an empty panel.
  test('is absent when the breakdown reported no groups', () => {
    expect(withBreakdown({ status: 'DEAD_LETTER' }, []).topFailures).toBeNull()
  })

  test('is absent when the breakdown could not be read at all', () => {
    expect(modelFor({ status: 'DEAD_LETTER' }).topFailures).toBeNull()
  })

  // The panel is fed by the breakdown alone: the breakdown only ever counts
  // dead letters, so a group in hand is enough.
  test('draws the panel on an unfiltered page whose counts could not be read', () => {
    const page = toEventsPage(
      {
        page: { events: [event()], pagination: pagination(), sourceErrors: [] },
        statuses,
        services,
        facets: null,
        breakdown: { groups: [group()], sourceErrors: [] },
        unavailable: false
      },
      {},
      now
    )

    // No figures on the chips — that read is the one that failed — and the
    // panel below them all the same.
    expect(page.statusFilters.every((chip) => chip.countLabel === null)).toBe(
      true
    )
    expect(page.topFailures?.count).toBe(1)
  })

  // And where the two reads disagree — a group in hand against a count of
  // zero — the one holding the failures wins.
  test('trusts the breakdown over a count that says there are none', () => {
    expect(
      withBreakdown({}, [group()], { DEAD_LETTER: 0 }).topFailures?.count
    ).toBe(1)
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
        cursor: 'END',
        direction: 'forward'
      }).topFailures?.groups ?? []

    expect(row.href).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+eventId_1&from=2026-06-16T09%3A00%3A00.000Z&to=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('drops the cursor from the link', () => {
    const [row] =
      withBreakdown({ cursor: 'END', direction: 'forward' }).topFailures
        ?.groups ?? []

    expect(row.href).not.toContain('cursor')
    expect(row.href).not.toContain('direction')
  })

  // The groups that recorded no message are counted like any other and cannot
  // be isolated like any other: `?error=` matches a message, and there is
  // none. So the row draws a dash and offers no link at all - the only page
  // one could open is wider than the row it sits on describes.
  test('names a group with no error a dash, and links it nowhere', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }, [
      group({ error: null, count: 12 })
    ]).topFailures
    const [row] = panel?.groups ?? []

    // The same dash an empty fact takes on the event page, and no title:
    // there is no fuller spelling of a dash to hang on one.
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

  // The strip holds one line, and a stack trace summary does not fit on it.
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

  // It travels like every other filter: narrowing by service while holding a
  // failure must not quietly widen the page back to every failure.
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

  // An operator who reached this page from the failures panel and then clicked
  // Service · GAS is asking about that failure on GAS, not about GAS.
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

  test('offers the ladder an operator actually climbs, plus Any time', () => {
    expect(timeRangeFor().presets.map(({ label }) => label)).toEqual([
      'Last 15m',
      'Last 1h',
      'Last 6h',
      'Last 24h',
      'Last 7d',
      'Last 30d'
    ])
  })

  // Each rung sets `from` and clears `to`: "the last hour" means up to now.
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

  test('clears the window, and its label with it, on Any time', () => {
    const range = timeRangeFor({
      status: 'DEAD_LETTER',
      from: '2026-06-15T10:20:00.000Z',
      range: '24h',
      cursor: 'END'
    })

    expect(range.anyTimeHref).toBe('/dev-ops/events?status=DEAD_LETTER')
  })

  // ── What the button says ───────────────────────────────────────────────

  test('says Any time on a page with no window on it', () => {
    const range = timeRangeFor()

    expect(range.label).toBe('Any time')
    expect(range.active).toBe(false)
    expect(range.anyTimeActive).toBe(true)
  })

  // The round trip the whole `range` parameter exists for: the link wrote an
  // absolute `from`, and by the time this page renders `now` has moved on, so
  // nothing about the instant still says which rung produced it. The name it
  // carried does.
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

  // The label is trusted only where it is consistent with the window it
  // claims to name, so a hand-edited url says the honest absolute thing.
  test('ignores a range label that does not fit the window it names', () => {
    expect(
      timeRangeFor({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-02T00:00:00.000Z',
        range: '24h'
      }).label
    ).toBe('2026-09-01 00:00 → 2026-09-02 00:00')

    expect(timeRangeFor({ range: '24h' }).label).toBe('Any time')
    expect(
      timeRangeFor({ from: '2026-09-01T00:00:00.000Z', range: 'nonsense' })
        .label
    ).toBe('2026-09-01 00:00 → now')
  })

  test('puts the label on the button title too', () => {
    expect(timeRangeFor().title).toBe('Time range: Any time')
  })
})

describe('the audit population', () => {
  const activeOf = (chips: FilterChip[]) =>
    chips.filter((chip) => chip.active).map((chip) => chip.value)

  // The words are Hide and Show, reading on from the "Audit records" label;
  // the wire keeps `exclude` and `include`.
  test('offers Hide and Show, and no counts on either', () => {
    const { auditFilters } = modelFor({})

    expect(auditFilters.map(({ value, label }) => [value, label])).toEqual([
      ['exclude', 'Hide'],
      ['include', 'Show']
    ])
    expect(auditFilters.every((chip) => chip.countLabel === null)).toBe(true)
    expect(auditFilters.every((chip) => chip.title)).toBe(true)
  })

  test('is excluded on a page that did not ask for it', () => {
    expect(activeOf(modelFor({}).auditFilters)).toEqual(['exclude'])
  })

  test('is included on a page that asked for it', () => {
    expect(activeOf(modelFor({ audit: 'include' }).auditFilters)).toEqual([
      'include'
    ])
  })

  test('reads an explicit exclude as the default said out loud', () => {
    expect(activeOf(modelFor({ audit: 'exclude' }).auditFilters)).toEqual([
      'exclude'
    ])
  })

  // The default is the parameterless url, so Hide drops the parameter
  // rather than spelling the default out: one page, one url.
  test('asks for the records with Show, and takes the parameter off with Hide', () => {
    const [exclude, include] = modelFor({ audit: 'include' }).auditFilters

    expect(exclude.href).toBe('/dev-ops/events')
    expect(include.href).toBe('/dev-ops/events?audit=include')
  })

  test('keeps every other filter, and drops the cursor, on both segments', () => {
    const { auditFilters } = modelFor({
      status: 'DEAD_LETTER',
      service: 'gas',
      q: 'gld-9b2',
      cursor: 'END',
      direction: 'forward'
    })

    expect(auditFilters.map((chip) => chip.href)).toEqual([
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2',
      '/dev-ops/events?status=DEAD_LETTER&service=gas&audit=include&q=gld-9b2'
    ])
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
  // Six states named in one word each is a vocabulary an operator is expected
  // to already have, and the two pairs that matter — Failed against Dead
  // letter, Published against Resubmitted — are exactly the ones the words do
  // not distinguish.
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
