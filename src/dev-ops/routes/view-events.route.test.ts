import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  EventBreakdownGroup,
  EventCounts,
  EventFacets,
  EventRow,
  EventsPagination,
  ServiceFilter,
  SourceError,
  StatusFilter
} from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'

vi.mock(import('../use-cases/get-events.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

/** No base url configured is the default, and switches the links off. */
const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

/**
 * One row as fg-gas-backend sends it: every word already chosen there. This
 * page decides only the links and the two relative instants.
 */
const event = (overrides: Partial<EventRow> = {}): EventRow => ({
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

/**
 * Whole overrides: a status arrives with its own label, role and retry glyph,
 * so setting one without the others would be a row no endpoint could send.
 */
const deadLettered: Partial<EventRow> = {
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false
}

const failed: Partial<EventRow> = {
  status: 'FAILED',
  statusLabel: 'Failed',
  statusRole: 'warning',
  statusRetrying: true
}

const completed: Partial<EventRow> = {
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success',
  statusRetrying: false
}

const inbox: Partial<EventRow> = {
  box: 'inbox',
  hop: 'GAS Inbox',
  queue: 'from Caseworking',
  queueValue: null,
  latencyTitle: 'Received to completed'
}

const statuses: StatusFilter[] = [
  {
    value: 'PUBLISHED',
    label: 'Published',
    explainer: 'Queued, not yet claimed'
  },
  {
    value: 'PROCESSING',
    label: 'Processing',
    explainer: 'Claimed, in flight'
  },
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

const givenEvents = (
  events: EventRow[] = [event()],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(overrides), sourceErrors },
    statuses,
    services,
    facets: facets(),
    breakdown: null,
    unavailable: false
  })

const group = (
  overrides: Partial<EventBreakdownGroup> = {}
): EventBreakdownGroup => ({
  error: 'E11000 duplicate key error collection: gas.events index: eventId_1',
  type: 'case.status.updated',
  count: 4182,
  firstAt: '2026-06-15T10:00:00.000Z',
  lastAt: '2026-06-16T10:16:05.000Z',
  ...overrides
})

const givenBreakdown = (
  groups: EventBreakdownGroup[] = [group()],
  countOverrides: Partial<EventCounts> = {},
  events: EventRow[] = [event(deadLettered)]
) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    statuses,
    services,
    facets: facets(countOverrides),
    breakdown: { groups, sourceErrors: [] },
    unavailable: false
  })

const givenCounts = (overrides: Partial<EventCounts>, events = [event()]) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    statuses,
    services,
    facets: facets(overrides),
    breakdown: null,
    unavailable: false
  })

/** Rows read fine, counts did not: segments fall back to plain labels. */
const givenNoCounts = (events: EventRow[] = [event()]) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    statuses,
    services,
    facets: null,
    breakdown: null,
    unavailable: false
  })

/**
 * Nothing could be read at all — which takes the vocabulary with it, so the
 * toolbar draws the two `All` segments and nothing else.
 */
const givenUnavailable = () =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events: [], pagination: pagination(), sourceErrors: [] },
    statuses: [],
    services: [],
    facets: null,
    breakdown: null,
    unavailable: true
  })

/** The endpoint understood this link's parameters and refused them. */
const givenRefused = () =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events: [], pagination: pagination(), sourceErrors: [] },
    statuses: [],
    services: [],
    facets: null,
    breakdown: null,
    unavailable: false,
    refused: true
  })

const xss = '<script>alert(1)</script>'

/** A retry storm: identical dead letters four minutes apart, one per attempt. */
const storm = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    event({
      ...deadLettered,
      id: `storm-${index}`,
      eventId: `storm-${index}-1111-2222-3333`,
      createdAt: new Date(
        Date.parse('2026-06-16T06:48:00.000Z') - index * 4 * 60 * 1000
      ).toISOString()
    })
  )

const failing = (message: string, name = 'MongoServerError') =>
  event({
    ...failed,
    lastError: { name, message, at: '2026-06-16T10:16:05.000Z' }
  })

/**
 * Every cell carries a string passed through from a Mongo document, so each
 * is checked to arrive as text rather than markup. The layout carries one
 * module script of its own (layouts/page.njk), which is why this looks inside
 * the cell rather than at the document. Facts rather than assertions, so each
 * test still owns its own `expect`.
 */
const escapingOf = ($: CheerioAPI, testId: string) => {
  const cell = $(`[data-testid="${testId}"]`)

  return {
    cells: cell.length,
    scripts: cell.find('script').length,
    text: cell.text()
  }
}

const rendersAsText = {
  cells: 1,
  scripts: 0,
  text: expect.stringContaining(xss) as unknown as string
}

/** A healthy row wears only the hover tint; a dead letter, the error wash. */
const rowClass =
  'relative cursor-pointer hover:bg-base-200 has-[:focus-visible]:bg-base-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-base-content'
const deadLetterRowClass =
  'relative cursor-pointer bg-error/5 hover:bg-error/10 has-[:focus-visible]:bg-error/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-base-content'

/**
 * The identity line is set with real spaces around its separators, so the
 * markup carries non-breaking ones. Every assertion on cell text reads them
 * back as the ordinary spaces they look like.
 */
const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** A cell's classes, as a string: a `td` the table styles carries none. */
const classOf = (cell: Cheerio<Element>) => cell.attr('class') ?? ''

/** A segment as it reads: `Dead letter 7,064`, or the word alone without one. */
const segments = ($: CheerioAPI, testId: string) =>
  $(`[data-testid="${testId}"]`)
    .toArray()
    .map((chip) => flatten($(chip).text()))

/** One segment, by the wire value it selects. `All` carries none. */
const segmentFor = ($: CheerioAPI, testId: string, value: string) =>
  $(`[data-testid="${testId}"][data-value="${value}"]`)

const headings = ($: CheerioAPI) => $('[data-testid="events-table"] thead th')

const viewPage = async (url = '/dev-ops/events') => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

let server: Server

/**
 * The Created At and Last Failure columns are relative and rendered on the
 * server, so the page is asserted against a clock the test owns. Only `Date`
 * is faked: hapi's own timeouts have to keep running for `server.inject`.
 */
const now = new Date('2026-06-16T10:20:00.000Z')

const errorMessage = 'E11000 duplicate key error collection: gas.events'
const errorFiltered = `/dev-ops/events?status=DEAD_LETTER&error=${encodeURIComponent(errorMessage)}`

describe('viewEventsRoute', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)

    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenEvents()
  })

  afterAll(async () => {
    vi.useRealTimers()
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/dev-ops/events'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user holding only the applications admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops/events',
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('forbids a signed in user holding no roles', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops/events',
      auth: {
        strategy: 'session',
        credentials: { user: { name: 'Ada Lovelace' }, scope: [] }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('renders the page for the operations admin role', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="events-table"]')).toHaveLength(1)
  })

  test('asks for the unfiltered page when no parameters are given', async () => {
    await viewPage()

    expect(getEventsUseCase).toHaveBeenCalledTimes(1)
    expect(getEventsUseCase).toHaveBeenCalledWith({})
  })

  // No `direction`: the list only pages forward, fg-gas-backend's default.
  test('forwards the cursor, status and service', async () => {
    await viewPage('/dev-ops/events?cursor=END&status=FAILED&service=gas')

    expect(getEventsUseCase).toHaveBeenCalledWith({
      cursor: 'END',
      status: 'FAILED',
      service: 'gas'
    })
  })

  // A link from the days of Newer and Older still opens a page rather than an
  // error: `forward` keeps its cursor, and `backward` — the old Newer — opens
  // the newest page, which is where Newer led. Neither reaches GAS.
  test.each([
    ['/dev-ops/events?cursor=END&direction=forward', { cursor: 'END' }],
    [
      '/dev-ops/events?cursor=START&direction=backward&status=FAILED',
      { status: 'FAILED' }
    ]
  ])('reads the stale link %s gracefully', async (url, expected) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith(expected)
  })

  // Refused here rather than forwarded: fg-gas-backend's 400 for a mistyped
  // filter was drawn as an outage on the page operators open to check for one.
  test.each([
    ['status', '/dev-ops/events?status=BOGUS'],
    // Exact values only: no case folding, because a url that means one thing
    // here and another at the endpoint is worse than one that is simply wrong.
    ['a mis-cased status', '/dev-ops/events?status=dead_letter'],
    ['a hyphenated status', '/dev-ops/events?status=dead-letter'],
    ['service', '/dev-ops/events?service=other'],
    ['a mis-cased service', '/dev-ops/events?service=GAS'],
    ['direction', '/dev-ops/events?direction=sideways']
  ])('refuses a %s the vocabulary does not hold', async (_name, url) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  test.each([
    ['/dev-ops/events?status=DEAD_LETTER', { status: 'DEAD_LETTER' }],
    ['/dev-ops/events?service=caseworking', { service: 'caseworking' }]
  ])('forwards %s, which it does hold', async (url, expected) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith(expected)
  })

  // The store keeps messages up to 1024 characters; a longer needle is one
  // nothing can match.
  test('takes an error filter as long as the store can hold', async () => {
    const { statusCode } = await viewPage(
      `/dev-ops/events?error=${'x'.repeat(1024)}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ error: 'x'.repeat(1024) })
  })

  test('refuses an error filter longer than any stored message', async () => {
    const { statusCode } = await viewPage(
      `/dev-ops/events?error=${'x'.repeat(1025)}`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  // ── Dates that never happened ────────────────────────────────────────────

  // `2026-13-01T00:00` gives an Invalid Date whose `toISOString()` throws;
  // `2026-02-30T00:00` is quieter — JavaScript rolls it forward to March 2.
  test.each([
    ['a month that does not exist', '2026-13-01T00:00'],
    ['a day February does not have', '2026-02-30T00:00'],
    ['a day April does not have', '2026-04-31T00:00'],
    ['an hour that does not exist', '2026-06-16T25:00'],
    ['the same, with seconds', '2026-02-30T00:00:00']
  ])('refuses %s in the range box', async (_name, value) => {
    const { statusCode } = await viewPage(
      `/dev-ops/events?from=${encodeURIComponent(value)}`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  test('refuses an impossible date in the To box too', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/events?to=2026-13-01T00%3A00'
    )

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  // The boundaries either side of it still work: a real leap day, the last
  // day of a 31-day month, and midnight.
  test.each([
    ['a leap day', '2028-02-29T00:00', '2028-02-29T00:00:00.000Z'],
    ['the last day of a month', '2026-01-31T23:59', '2026-01-31T23:59:00.000Z'],
    [
      'a value carrying seconds',
      '2026-06-16T09:00:30',
      '2026-06-16T09:00:30.000Z'
    ]
  ])('takes %s and reads it as UTC', async (_name, value, instant) => {
    const { statusCode } = await viewPage(
      `/dev-ops/events?from=${encodeURIComponent(value)}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ from: instant })
  })

  // An instant off a shared url is not a local datetime and is not this app's
  // to judge: it travels untouched.
  test('passes an ISO instant through untouched', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09%3A00%3A00.000Z'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({
      from: '2026-06-16T09:00:00.000Z'
    })
  })

  // Both filters are links, and a link either carries the filter or does not —
  // an empty one is a url nobody issued.
  test.each(['status', 'service'])(
    'refuses an empty %s, which no control of this page can produce',
    async (name) => {
      const { statusCode } = await viewPage(`/dev-ops/events?${name}=`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(getEventsUseCase).not.toHaveBeenCalled()
    }
  )

  test('forwards the search', async () => {
    await viewPage('/dev-ops/events?q=gld-9b2')

    expect(getEventsUseCase).toHaveBeenCalledWith({ q: 'gld-9b2' })
  })

  test('refuses a kind rather than forwarding it', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?kind=audit')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  test('trims the search before forwarding it', async () => {
    await viewPage('/dev-ops/events?q=%20%20gld-9b2%20')

    expect(getEventsUseCase).toHaveBeenCalledWith({ q: 'gld-9b2' })
  })

  // Clearing the box with the keyboard submits `q=`, and the endpoint answers
  // 400 for an empty needle. An empty search is no search.
  test('treats an empty search as no search at all', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?q=&status=FAILED')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ status: 'FAILED' })
  })

  // The alert is for a backend that is actually unwell: a query this app
  // knows how to spell, refused by GAS.
  test('shows the error alert when the endpoint could not be read at all', async () => {
    givenUnavailable()

    const { statusCode, $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="events-error"]')).toHaveLength(1)
    expect($('.govuk-heading-xl')).toHaveLength(0)
  })

  // A hand-edited cursor or an unparseable range reaches GAS and comes back
  // refused. Painting that as an outage tells an operator the estate is down
  // on the very page they opened to check whether it is.
  test('says the link was refused rather than painting an outage', async () => {
    givenRefused()

    const { statusCode, $ } = await viewPage('/dev-ops/events?cursor=garbage')

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="events-refused"]')).toHaveLength(1)
    expect($('[data-testid="events-error"]')).toHaveLength(0)
    expect($('[data-testid="events-refused-clear"]').attr('href')).toBe(
      '/dev-ops/events'
    )
  })

  test('rejects a query parameter it does not know', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/dev-ops/events?page=2',
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('titles the page Events', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toContain('Events |')
    expect($('[data-testid="events-title"]').text().trim()).toBe('Events')
  })

  test('says what the page is, and leaves the filter to the chips', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-subtitle"]').text().trim()).toBe(
      'Inbox and outbox messages across GAS, Caseworking and connected services.'
    )
    expect($('main').text()).not.toContain('No filter applied')
    expect($('main').text()).not.toContain('Filtered:')
  })

  // Each tile says what selecting it would find, and All is no exception:
  // every status summed. The services carry no figures at all.
  test('counts every status tile, All as their sum, and no service', async () => {
    const { $ } = await viewPage()

    expect(segments($, 'events-status-tile')).toEqual([
      'All 243,260',
      'Published 0',
      'Processing 0',
      'Failed 0',
      'Resubmitted 0',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'CW-BE'
    ])
    expect(
      $('[data-testid="events-filter-service-panel"] .badge')
    ).toHaveLength(0)
  })

  // The counts endpoint refuses `status`, which is what keeps every tile
  // counted whatever is selected — All included: the figures are facets.
  test('keeps every tile counted on a page filtered to one of them', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect(segments($, 'events-status-tile')).toEqual([
      'All 243,260',
      'Published 0',
      'Processing 0',
      'Failed 0',
      'Resubmitted 0',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
  })

  test('marks the selected service without numbering any of them', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'CW-BE'
    ])
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('aria-current')
    ).toBe('page')
  })

  // Compact: a text-xl value at least 7ch wide, so a tile keeps its width as
  // its count moves.
  test("sets the figure as the tile's value", async () => {
    const { $ } = await viewPage()

    expect(
      segmentFor($, 'events-status-tile', 'COMPLETED')
        .find('[data-testid="events-status-tile-count"]')
        .attr('class')
    ).toBe('stat-value min-w-[7ch] text-xl tabular-nums')
  })

  // A tile that vanished when it emptied could not be told from one the page
  // had forgotten to draw: it stays, as a quiet 0, and stays a link.
  test('draws an empty status as a quiet 0, and still links it', async () => {
    const { $ } = await viewPage()

    const failed = segmentFor($, 'events-status-tile', 'FAILED')
    const count = failed.find('[data-testid="events-status-tile-count"]')

    expect(flatten(failed.text())).toBe('Failed 0')
    expect(count.attr('class')).toContain('text-base-content/60')
    expect(failed.attr('href')).toBe('/dev-ops/events?status=FAILED')
    expect(
      segmentFor($, 'events-status-tile', 'COMPLETED')
        .find('[data-testid="events-status-tile-count"]')
        .attr('class')
    ).not.toContain('text-base-content/60')
  })

  // A segment with no figure is not an empty one: the dimming follows `zero`,
  // and dimming a label that never had a number would read as "none of these".
  test('dims no service segment, none of them having a count', async () => {
    const { $ } = await viewPage()

    for (const service of ['gas', 'caseworking']) {
      expect(
        segmentFor($, 'events-filter-service-chip', service).attr('class')
      ).not.toContain('text-base-content/60')
    }
  })

  // Red text, as the prototype draws it: a known, accepted contrast
  // shortfall. No dead letters is a quiet nought, not a red one.
  test('colours the dead letter count, and only while there is one', async () => {
    const { $ } = await viewPage()

    const count = segmentFor($, 'events-status-tile', 'DEAD_LETTER').find(
      '[data-testid="events-status-tile-count"]'
    )

    expect(count.text()).toBe('7,064')
    expect(count.attr('class')).toBe(
      'stat-value min-w-[7ch] text-xl tabular-nums text-error'
    )
    expect($('[data-testid="events-status-tiles"] .badge')).toHaveLength(0)

    givenCounts({ DEAD_LETTER: 0 })

    const { $: quiet } = await viewPage()

    const nought = segmentFor(quiet, 'events-status-tile', 'DEAD_LETTER').find(
      '[data-testid="events-status-tile-count"]'
    )

    expect(nought.text()).toBe('0')
    expect(nought.attr('class')).toBe(
      'stat-value min-w-[7ch] text-xl tabular-nums text-base-content/60'
    )
    expect(quiet('[data-testid="events-status-tiles"]').html()).not.toContain(
      'text-error'
    )
  })

  test('draws every tile with a quiet dash when the counts fail', async () => {
    givenNoCounts()

    const { $ } = await viewPage()

    expect(segments($, 'events-status-tile')).toEqual([
      'All —',
      'Published —',
      'Processing —',
      'Failed —',
      'Resubmitted —',
      'Completed —',
      'Dead letter —'
    ])
    // Named without a figure rather than with a made-up one.
    expect(
      $('[data-testid="events-status-tile"]').first().attr('aria-label')
    ).toBe('All statuses')
    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'CW-BE'
    ])
    expect($('[data-testid="events-filter-kind-chip"]')).toHaveLength(0)
    expect($('[data-testid="events-status-tiles"]').html()).not.toContain(
      'text-error'
    )
    expect($('[data-testid="events-error"]')).toHaveLength(0)
    expect($('[data-testid="events-partial"]')).toHaveLength(0)
  })

  test('explains what each status tile is counting', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="events-status-tile"]')
        .toArray()
        .map((tile) => $(tile).attr('title'))
    ).toEqual([
      undefined,
      'Queued, not yet claimed',
      'Claimed, in flight',
      'Awaiting automatic retry',
      'Queued for another retry cycle',
      'Processed successfully',
      'Failed all retry attempts; needs a redrive'
    ])
  })

  // The name says the figure in words, so a screen reader hears a count and
  // not a bare number after a word.
  test('names each tile with its figure', async () => {
    const { $ } = await viewPage()

    const names = $('[data-testid="events-status-tile"]')
      .toArray()
      .map((tile) => $(tile).attr('aria-label'))

    expect(names[0]).toBe('All statuses: 243,260 events')
    expect(names.at(-1)).toBe('Dead letter: 7,064 events')
    expect(names[1]).toBe('Published: 0 events')
  })

  test('says one event in the singular on a tile', async () => {
    givenCounts({ FAILED: 1, COMPLETED: 0, DEAD_LETTER: 0 })

    const { $ } = await viewPage()

    expect(
      segmentFor($, 'events-status-tile', 'FAILED').attr('aria-label')
    ).toBe('Failed: 1 event')
  })

  test('groups the tiles as the status filter', async () => {
    const { $ } = await viewPage()

    const strip = $('[data-testid="events-status-tiles"]')

    expect(strip.attr('role')).toBe('group')
    expect(strip.attr('aria-label')).toBe('Filter by status')
    expect(strip.hasClass('stats')).toBe(true)
    expect(strip.hasClass('stats-horizontal')).toBe(true)
    expect(
      strip
        .find('[data-testid="events-status-tile"]')
        .toArray()
        .every((tile) => $(tile).is('a') && $(tile).hasClass('stat'))
    ).toBe(true)
  })

  // Time and Service are md triggers, each opening a native popover menu
  // anchored to it: the popover is the whole of the behaviour, no script.
  test('draws Time and Service as md triggers opening a popover', async () => {
    const { $ } = await viewPage()

    for (const [button, panel] of [
      ['events-range-button', 'events-range-panel'],
      ['events-filter-service-button', 'events-service-panel']
    ]) {
      const trigger = $(`[data-testid="${button}"]`)

      expect(trigger.is('button')).toBe(true)
      expect(trigger.hasClass('btn')).toBe(true)
      expect(trigger.hasClass('btn-sm')).toBe(false)
      expect(trigger.attr('popovertarget')).toBe(panel)
      // The pressed look while open is keyed off the popover being the
      // trigger's next sibling.
      expect(trigger.next().attr('id')).toBe(panel)
      expect(trigger.next().attr('popover')).toBeDefined()
      expect(classOf(trigger)).toContain('[&:has(+:popover-open)]')
    }
  })

  test('gives the toolbar no border or surface of its own', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-toolbar"]')

    expect(toolbar).toHaveLength(1)
    expect(toolbar.attr('class')).toContain('items-center')
    expect(toolbar.attr('class')).not.toContain('border')
    expect(toolbar.attr('class')).not.toContain('bg-base-100')
    // The triggers name their own filters; there are no labels beside them.
    expect($('[data-testid="events-filter-label"]')).toHaveLength(0)
  })

  // ── The audit population ─────────────────────────────────────────────────

  // Off is the default and the parameterless url; the link goes to the other
  // state, so following it IS the flip.
  test('shows the audit switch off by default, linking to on', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="events-filter-audit-switch"]')
    const toggle = $('[data-testid="events-filter-audit-toggle"]')

    expect(link.attr('href')).toBe('/dev-ops/events?audit=include')
    expect(toggle.attr('aria-checked')).toBe('false')
    expect(flatten(link.text())).toBe('Show audit events, off')
    expect(link.attr('title')).toBe('Show audit events alongside the queue')
    expect($('do-audit-switch').attr('data-checked')).toBe('false')
  })

  test('shows the audit switch on when asked, linking back to off', async () => {
    const { $ } = await viewPage('/dev-ops/events?audit=include')

    const link = $('[data-testid="events-filter-audit-switch"]')

    expect(
      $('[data-testid="events-filter-audit-toggle"]').attr('aria-checked')
    ).toBe('true')
    expect(flatten(link.text())).toBe('Show audit events, on')
    // Switching off drops the parameter rather than spelling out the
    // default: one page, one url.
    expect(link.attr('href')).toBe('/dev-ops/events')
    expect($('do-audit-switch').attr('data-checked')).toBe('true')
  })

  // A link, and nothing interactive inside it: the switch is a span drawn by
  // daisyUI's `toggle`, hidden from assistive tech, and the hidden ", on" /
  // ", off" carries the state in the link's name.
  test('draws the audit switch as one plain link', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="events-filter-audit-switch"]')
    const toggle = $('[data-testid="events-filter-audit-toggle"]')

    expect(link.is('a')).toBe(true)
    expect(link.find('input, button')).toHaveLength(0)
    expect(link.hasClass('btn')).toBe(false)
    expect(link.hasClass('cursor-pointer')).toBe(true)
    expect(link.hasClass('h-10')).toBe(true)
    expect(toggle.is('span')).toBe(true)
    expect(toggle.hasClass('toggle')).toBe(true)
    expect(toggle.attr('aria-hidden')).toBe('true')
    expect(
      $('[data-testid="events-filter-audit-state"]').hasClass('sr-only')
    ).toBe(true)
  })

  // The population changes underneath a keyset position, so the cursor is
  // not carried.
  test('carries every other filter, and drops the cursor, on the switch', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=gld-9b2&cursor=END&direction=forward'
    )

    expect($('[data-testid="events-filter-audit-switch"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&audit=include&q=gld-9b2'
    )
  })

  test('threads the audit setting through every filter link and form', async () => {
    const { $ } = await viewPage('/dev-ops/events?audit=include')

    expect(
      segmentFor($, 'events-status-tile', 'DEAD_LETTER').attr('href')
    ).toContain('audit=include')
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('href')
    ).toContain('audit=include')
    expect(
      $('[data-testid="events-range-preset"]').first().attr('href')
    ).toContain('audit=include')
    for (const form of ['events-search-filter', 'events-range-filter']) {
      expect(
        $(`[data-testid="${form}"]`)
          .toArray()
          .map((field) => [$(field).attr('name'), $(field).attr('value')])
      ).toContainEqual(['audit', 'include'])
    }
  })

  test('forwards the audit setting to the endpoint, and nothing when default', async () => {
    await viewPage('/dev-ops/events?audit=include')

    expect(getEventsUseCase).toHaveBeenCalledWith({ audit: 'include' })

    vi.mocked(getEventsUseCase).mockClear()

    await viewPage()

    expect(getEventsUseCase).toHaveBeenCalledWith({})
  })

  test.each(['sometimes', 'INCLUDE', ''])(
    'refuses ?audit=%s, which the vocabulary does not hold',
    async (value) => {
      const { statusCode } = await viewPage(`/dev-ops/events?audit=${value}`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(getEventsUseCase).not.toHaveBeenCalled()
    }
  )

  test('accepts an explicit exclude, which is the default said out loud', async () => {
    const { statusCode, $ } = await viewPage('/dev-ops/events?audit=exclude')

    expect(statusCode).toBe(statusCodes.ok)
    expect(
      $('[data-testid="events-filter-audit-toggle"]').attr('aria-checked')
    ).toBe('false')
    expect($('[data-testid="events-filter-audit-switch"]').attr('href')).toBe(
      '/dev-ops/events?audit=include'
    )
  })

  // One row: the window, the service and the audit switch, then the search
  // hard right. The status filter is the strip of tiles above it.
  test('lays the toolbar out as Time, Service, the audit switch, then search', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-toolbar"]')

    expect(
      toolbar
        .children()
        .toArray()
        .map((child) => $(child).attr('data-testid'))
    ).toEqual([
      'events-range',
      'events-filter-service',
      'do-audit-switch',
      'events-search'
    ])
    expect(toolbar.hasClass('flex-wrap')).toBe(true)
    expect($('[data-testid="events-search"]').hasClass('ml-auto')).toBe(true)
  })

  test('offers no Status control in the toolbar', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-toolbar"]')

    expect($('[data-testid="events-filter-status"]')).toHaveLength(0)
    expect(toolbar.find('[aria-label="Filter by status"]')).toHaveLength(0)
    expect(toolbar.find('[data-testid="events-status-tile"]')).toHaveLength(0)
    expect(toolbar.text()).not.toContain('Dead letter')
  })

  // The filter's name and its value as one phrase, the name quieter than
  // the value.
  test("names each trigger's filter and its value in one phrase", async () => {
    const { $ } = await viewPage()

    const service = $('[data-testid="events-filter-service-button"]')
    const time = $('[data-testid="events-range-button"]')

    expect(flatten(service.text())).toBe('Service: All')
    expect(flatten(time.text())).toBe('Time: Any')
    for (const trigger of [service, time]) {
      const name = trigger.find('span > span').first()

      expect(name.attr('class')).toBe('font-normal opacity-70')
      expect(trigger.find('[data-testid="do-icon-chevron-down"]')).toHaveLength(
        1
      )
    }
  })

  // An active filter wears the inverse fill; a default one stays plain.
  test('fills a trigger whose filter is on, and only then', async () => {
    const { $: plain } = await viewPage()

    for (const id of ['events-filter-service-button', 'events-range-button']) {
      expect(plain(`[data-testid="${id}"]`).hasClass('bg-base-content')).toBe(
        false
      )
    }

    const { $ } = await viewPage(
      '/dev-ops/events?service=gas&from=2026-06-15T10:19:57.000Z&range=24h'
    )
    const service = $('[data-testid="events-filter-service-button"]')

    expect(flatten(service.text())).toBe('Service: GAS')
    for (const id of ['events-filter-service-button', 'events-range-button']) {
      const trigger = $(`[data-testid="${id}"]`)

      expect(trigger.hasClass('bg-base-content')).toBe(true)
      expect(trigger.hasClass('text-base-100')).toBe(true)
      expect(trigger.hasClass('border-base-content')).toBe(true)
    }
  })

  // The selected item is ticked and bold and carries `aria-current`; there
  // is no `menu-active` fill. Every item draws the tick, invisible where
  // unselected, so the labels share one left edge.
  test('ticks the selected menu item, and fills none', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    const panel = $('[data-testid="events-filter-service-panel"]')
    const gas = segmentFor($, 'events-filter-service-chip', 'gas')
    const all = $('[data-testid="events-filter-service-chip"]').first()

    expect(panel.hasClass('menu-md')).toBe(true)
    expect(panel.hasClass('mt-2')).toBe(true)
    expect(panel.hasClass('w-60')).toBe(true)
    expect(gas.attr('aria-current')).toBe('page')
    expect(gas.hasClass('font-semibold')).toBe(true)
    expect(
      gas.find('[data-testid="do-icon-check"]').hasClass('invisible')
    ).toBe(false)
    expect(all.attr('aria-current')).toBeUndefined()
    expect(all.hasClass('font-semibold')).toBe(false)
    expect(
      all.find('[data-testid="do-icon-check"]').hasClass('invisible')
    ).toBe(true)
    expect(
      $('main [data-testid="do-icon-check"]')
        .toArray()
        .every((tick) => $(tick).attr('aria-hidden') === 'true')
    ).toBe(true)
    expect($('main').html()).not.toContain('menu-active')
  })

  // The figures are the tiles'; the toolbar counts nothing of its own.
  test('counts nothing in the toolbar at all', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-toolbar"]')

    expect(toolbar.text()).not.toMatch(/\d[\d,]* events?\b/)
    expect(toolbar.find('.badge')).toHaveLength(0)
    expect(toolbar.find('[data-testid="events-count"]')).toHaveLength(0)
  })

  // The selected tile wears the triggers' inverse fill, and `aria-current`
  // says which slice the table is showing.
  test('marks the tile the page is filtered to', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const active = $('[data-testid="events-status-tile"][aria-current]')

    expect(active).toHaveLength(1)
    expect(active.attr('aria-current')).toBe('page')
    expect(active.attr('data-value')).toBe('DEAD_LETTER')
    expect(active.hasClass('bg-base-content')).toBe(true)
    expect(active.hasClass('text-base-100')).toBe(true)

    const all = $('[data-testid="events-status-tile"]').first()

    expect(all.attr('aria-current')).toBeUndefined()
    expect(all.hasClass('bg-base-content')).toBe(false)
  })

  // `stats` scrolls on overflow and would clip an outer ring, so the focus
  // outline is drawn inside the tile.
  test("draws each tile's focus ring inside it", async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    for (const tile of $('[data-testid="events-status-tile"]').toArray()) {
      expect($(tile).hasClass('focus-visible:-outline-offset-4')).toBe(true)
    }
  })

  test('selects All statuses and All services on a page opened with no filter', async () => {
    const { $ } = await viewPage()

    const active = $('[aria-current="page"]')
      .toArray()
      .map((option) => flatten($(option).text()))

    expect(active).toEqual(['All 243,260', 'All'])
  })

  test('renders every tile as a link that keeps the other filters', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    expect(segmentFor($, 'events-status-tile', 'FAILED').attr('href')).toBe(
      '/dev-ops/events?status=FAILED&service=gas'
    )
    expect($('[data-testid="events-status-tile"]').first().attr('href')).toBe(
      '/dev-ops/events?service=gas'
    )
  })

  test('drops the cursor from every filter link, restarting the paging', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?cursor=END&direction=forward&status=FAILED'
    )

    const hrefs = $(
      '[data-testid="events-status-tiles"] a, [data-testid="events-toolbar"] a'
    )
      .toArray()
      .map((link) => $(link).attr('href') ?? '')

    expect(hrefs).not.toHaveLength(0)
    expect(hrefs.some((href) => href.includes('cursor'))).toBe(false)
    expect(hrefs.some((href) => href.includes('direction'))).toBe(false)
  })

  test('keeps the filters on a page whose filter found nothing', async () => {
    givenEvents([])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-empty"]')).toHaveLength(1)
    expect($('[data-testid="events-status-tile"]')).toHaveLength(7)
    expect($('[data-testid="events-toolbar"]')).toHaveLength(1)
  })

  test('keeps the filter bar when nothing could be read at all', async () => {
    givenUnavailable()

    const { $ } = await viewPage()

    expect($('[data-testid="events-toolbar"]')).toHaveLength(1)
  })

  test('sits the tiles and the toolbar between the heading and the table', async () => {
    const { $ } = await viewPage()

    const order = $('main [data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        [
          'events-heading',
          'events-status-tiles',
          'events-toolbar',
          'events-card'
        ].includes(id ?? '')
      )

    expect(order).toEqual([
      'events-heading',
      'events-status-tiles',
      'events-toolbar',
      'events-card'
    ])
  })

  test('draws no TYPE control at all', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filter-kind"]')).toHaveLength(0)
    expect($('[data-testid="events-filter-kind-chip"]')).toHaveLength(0)
  })

  test('puts no kind on any filter segment link', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?cursor=END&status=FAILED&service=gas&q=gld-9b2'
    )

    for (const href of $('a[href]')
      .toArray()
      .map((link) => $(link).attr('href') ?? '')) {
      expect(href).not.toContain('kind=')
    }
  })

  test('keeps the search on the status tiles and the service menu', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const hrefs = $(
      '[data-testid="events-status-tile"], [data-testid="events-filter-service-chip"]'
    )
      .toArray()
      .map((link) => $(link).attr('href') ?? '')

    expect(hrefs).toHaveLength(10)
    expect(hrefs.every((href) => href.includes('q=gld-9b2'))).toBe(true)
  })

  test('offers a search box in the toolbar, holding the current search', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const form = $('[data-testid="events-search"]')
    const input = $('[data-testid="events-search-input"]')

    expect(form.closest('[data-testid="events-toolbar"]')).toHaveLength(1)
    // md, like every control in the toolbar.
    expect($('[data-testid="events-search-label"]').attr('class')).toBe(
      'input join-item w-80'
    )
    expect($('[data-testid="events-search-submit"]').attr('class')).toBe(
      'btn join-item'
    )
    expect(form.attr('method')).toBe('get')
    expect(form.attr('action')).toBe('/dev-ops/events')
    expect(input.attr('type')).toBe('search')
    expect(input.attr('name')).toBe('q')
    expect(input.attr('value')).toBe('gld-9b2')
    expect(input.attr('placeholder')).toBe('Event id, message id or reference…')
    expect(
      $('[data-testid="events-search-label"] [data-testid="do-icon-search"]')
    ).toHaveLength(1)
    expect(input.closest('[data-testid="events-search-label"]')).toHaveLength(1)
    expect($('[data-testid="events-search-submit"]').attr('type')).toBe(
      'submit'
    )
  })

  test('opens the search box empty on a page that is not a search', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-search-input"]').attr('value')).toBe('')
  })

  // Without the hidden fields, searching from a page filtered to Dead letter
  // would quietly widen it to every status; the cursor is not among them.
  test('carries the filters through a search, and the cursor through none', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?cursor=END&direction=forward&status=FAILED&service=gas'
    )

    const hidden = $('[data-testid="events-search-filter"]')
      .toArray()
      .map((field) => [$(field).attr('name'), $(field).attr('value')])

    expect(hidden).toEqual([
      ['status', 'FAILED'],
      ['service', 'gas']
    ])
    expect($('[data-testid="events-search"] [name="cursor"]')).toHaveLength(0)
    expect($('[data-testid="events-search"] [name="direction"]')).toHaveLength(
      0
    )
  })

  test('carries no hidden fields on an unfiltered page', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-search-filter"]')).toHaveLength(0)
  })

  test('heads the table with real th cells, in sentence case', async () => {
    const { $ } = await viewPage()

    const heading = headings($).eq(0)

    expect(heading.is('th')).toBe(true)
    expect(heading.text().trim()).toBe('Event')
    expect($('[data-testid="events-table"] thead')).toHaveLength(1)
  })

  // An auto table measures its contents, so a page of 24-hex ids sized Event
  // differently from a page of uuids and paging read as a rebuild. Two sets
  // of shares: one tuned at 1024px, and one from `xl` that gives the short
  // columns' spare width back to Event.
  test('fixes the column widths in proportion, on the headers', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toContain(
      'table-fixed'
    )
    expect(
      headings($)
        .toArray()
        .map((cell) =>
          classOf($(cell))
            .split(' ')
            .filter((name) => /(^|:)w-/.test(name))
        )
    ).toEqual([
      ['w-[41%]', 'xl:w-[52.5%]'],
      ['w-[9%]', 'xl:w-[6.5%]'],
      ['w-[21%]', 'xl:w-[18.5%]'],
      ['w-[15%]', 'xl:w-[12.5%]'],
      ['w-[14%]', 'xl:w-[10%]']
    ])
  })

  // The proportions do not move with the filter: a table that re-lays itself
  // out on selection is rebuilt exactly when the operator works fastest.
  test('holds the same proportions whatever the page is filtered to', async () => {
    const { $: healthy } = await viewPage()

    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $: dead } = await viewPage('/dev-ops/events?status=DEAD_LETTER')
    const widths = ($: CheerioAPI) =>
      headings($)
        .toArray()
        .map((cell) => classOf($(cell)))

    expect(widths(healthy)).toEqual(widths(dead))
    expect(dead('[data-testid="event-row"] > td')).toHaveLength(5)
  })

  // A fixed column cannot grow to fit, so the name, the id, the service and
  // the box are cut by the column rather than wrapping. None carries a title:
  // a row that is one big link shows no tooltip, and the raw type and the
  // transport are the row's own page to show.
  test('cuts what outruns a fixed column, and hangs no tooltip on the row', async () => {
    givenEvents([failing('connect ETIMEDOUT 10.0.3.14:443')])

    const { $ } = await viewPage()

    for (const testId of [
      'event-link',
      'event-id',
      'event-service',
      'event-box'
    ]) {
      const cell = $(`[data-testid="${testId}"]`)

      expect(classOf(cell)).toContain('truncate')
      expect(cell.attr('title')).toBeUndefined()
    }
    // The cut sits inside the cell: an `overflow: hidden` cell would take
    // the hit-test from the row's stretched link.
    for (const testId of ['event-service', 'event-box']) {
      expect(classOf($(`[data-testid="${testId}"]`).parent())).not.toContain(
        'overflow-hidden'
      )
    }
  })

  // Created is the one column of figures, right-aligned; Service and Queue
  // are two short words each, centred; Event and Status keep the left edge.
  test('aligns each column, header and cells alike', async () => {
    givenEvents([event({ ...completed, latency: '1.2s' })])

    const { $ } = await viewPage()

    const alignOf = (cell: Cheerio<Element>) =>
      classOf(cell)
        .split(' ')
        .filter(
          (name) =>
            name.startsWith('text-') && /(left|center|right)$/.test(name)
        )
    const heads = headings($)
      .toArray()
      .map((cell) => alignOf($(cell)))
    const cells = $('[data-testid="event-row"]')
      .first()
      .find('> td')
      .toArray()
      .map((cell) => alignOf($(cell)))
    const expected = [[], ['text-center'], ['text-center'], [], ['text-right']]

    expect(heads).toEqual(expected)
    expect(cells).toEqual(expected)
    // The status's "took …" line keeps its indent under the label.
    expect($('[data-testid="event-latency"]').attr('class') ?? '').toContain(
      'pl-3.5'
    )
  })

  test('sets every figure in tabular monospace', async () => {
    givenEvents([event({ ...completed, latency: '1.2s' })])

    const { $ } = await viewPage()

    const figures = [
      $('[data-testid="event-created-at"]'),
      $('[data-testid="event-latency"]')
    ]

    figures.forEach((figure) => {
      expect(figure.attr('class')).toContain('font-mono')
      expect(figure.attr('class')).toContain('tabular-nums')
    })
  })

  // The service and the box as columns of their own, where one column used
  // to join them as the hop.
  test('heads the table with its five columns in order', async () => {
    const { $ } = await viewPage()

    expect(
      headings($)
        .toArray()
        .map((cell) => $(cell).text().trim())
    ).toEqual(['Event', 'Service', 'Queue', 'Status', 'Created'])
  })

  test('adds no further column for actions, counts, failures or a source chip', async () => {
    const { $ } = await viewPage()

    expect(headings($)).toHaveLength(5)
    expect($('[data-testid="event-row"]').first().find('> td')).toHaveLength(5)
  })

  test("starts every row at the event's name, with no gutter and no caret", async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    const firsts = $('[data-testid="event-row"]')
      .toArray()
      .map((row) => $(row).find('> td').first())

    expect(firsts).toHaveLength(4)
    firsts.forEach((cell) => {
      expect(cell.children().first().attr('data-testid')).toBe('event-link')
    })
    expect($('[data-testid="events-table"] .do-caret')).toHaveLength(0)
    expect($('[data-testid="events-table"] input')).toHaveLength(0)
    expect(headings($).first().text().trim()).toBe('Event')
  })

  test('builds the table as a real table, with no roles bolted on', async () => {
    const { $ } = await viewPage()

    const table = $('[data-testid="events-table"]')

    expect(table.is('table')).toBe(true)
    expect(table.hasClass('table')).toBe(true)
    expect(table.attr('role')).toBeUndefined()
    expect($('[data-testid="events-head"]').is('tr')).toBe(true)
    expect($('[data-testid="events-head"]').closest('thead')).toHaveLength(1)
    expect($('[data-testid="event-row"]').first().is('tr')).toBe(true)
    expect(
      $('[data-testid="event-row"]').first().closest('tbody')
    ).toHaveLength(1)
    expect($('[data-testid="events-table"] [role="cell"]')).toHaveLength(0)
  })

  // A column of figures whose heading has scrolled away is unlabelled numbers.
  test('pins the header to the top of the scroll box', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toContain(
      'table-pin-rows'
    )
  })

  test('renders a row for every event', async () => {
    givenEvents([
      event({ eventId: 'one', type: 'case.created' }),
      event({ eventId: 'two', type: 'case.approved' }),
      event({ eventId: 'three', type: 'case.status.updated' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]')).toHaveLength(3)
    expect($('[data-testid="event-group"]')).toHaveLength(0)
  })

  test('leaves a row with nothing beside it as a plain row', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-group"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]')).toHaveLength(1)
  })

  test('draws no rollup strip at all', async () => {
    givenEvents(storm(20))

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup"]')).toHaveLength(0)
    expect($('[data-testid="events-count-chip"]')).toHaveLength(0)
    expect($('[data-testid="events-counts-label"]')).toHaveLength(0)
    expect($('[data-testid="events-rollup-bucket"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Across current filters')
  })

  test('falls back to no arithmetic of its own when the counts fail', async () => {
    givenNoCounts([
      event({ id: '1', status: 'DEAD_LETTER' }),
      event({ id: '2', status: 'FAILED' }),
      event({ id: '3', status: 'PUBLISHED' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-bucket"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('dead-lettered')
    expect($('main').text()).not.toContain('in flight')
  })

  test('says nothing about how many groups the rows fold into', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-groups"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('1 group')
  })

  test('says nothing about the age of the oldest row on the page', async () => {
    givenEvents([
      event({ id: '1', createdAt: '2026-06-16T10:00:00.000Z' }),
      event({ id: '2', createdAt: '2026-06-16T06:33:00.000Z', type: 'other' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-oldest"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('oldest')
  })

  // Three filters arrive with no segment to sit in: the search, the failure,
  // and the window. Each is a filter an operator forgets is on, so each is
  // said in words under the toolbar with the way out of it beside it.
  test('says what the page is a search of, with a way out of it', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED&q=gld-9b2')

    const note = $('[data-testid="events-note-search"]')
    const clear = $('[data-testid="events-note-search-clear"]')

    expect(flatten(note.text())).toBe('Matching "gld-9b2"')
    expect(note.closest('[data-testid="events-filter-notes"]')).toHaveLength(1)
    expect(clear.text().trim()).toBe('Clear ×')
    expect(clear.attr('href')).toBe('/dev-ops/events?status=FAILED')
  })

  test('sits the notes between the toolbar and the card', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const order = $('main [data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        ['events-toolbar', 'events-filter-notes', 'events-card'].includes(
          id ?? ''
        )
      )

    expect(order).toEqual([
      'events-toolbar',
      'events-filter-notes',
      'events-card'
    ])
  })

  test('says nothing at all on a page with no such filter on it', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filter-notes"]')).toHaveLength(0)
    expect($('[data-testid="events-note-search"]')).toHaveLength(0)
    expect($('[data-testid="events-note-search-clear"]')).toHaveLength(0)
  })

  test('separates the notes it has, and no more', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    expect(flatten($('[data-testid="events-filter-notes"]').text())).toBe(
      'Matching "gld-9b2" Clear ×'
    )
  })

  test('keeps the search said back on a page whose search found nothing', async () => {
    givenEvents([])

    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    expect(flatten($('[data-testid="events-note-search"]').text())).toBe(
      'Matching "gld-9b2"'
    )
    expect($('[data-testid="events-empty"]')).toHaveLength(1)
  })

  // ── The total ───────────────────────────────────────────────────────────

  // The All tile carries the figure; the card states no total of its own.
  test('states no total over the table', async () => {
    for (const url of [
      '/dev-ops/events',
      '/dev-ops/events?status=DEAD_LETTER'
    ]) {
      const { $ } = await viewPage(url)

      expect($('[data-testid="events-total"]')).toHaveLength(0)
      expect($('[data-testid="events-card"]').text()).not.toMatch(
        /\d[\d,]* events?\b/
      )
    }
  })

  test('claims no total the endpoint never reported', async () => {
    givenEvents(storm(20), { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('main').text()).not.toContain('Total')
  })

  test('draws no card and no pager on a page with no rows', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]')).toHaveLength(0)
    expect($('[data-testid="do-pager"]')).toHaveLength(0)
  })

  // What the event is leads the row, at full contrast and in the sans face,
  // so it never reads as the id.
  test('leads the identity cell with the name, in semibold sans', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="event-link"]')

    expect(link.find('[data-testid="event-type-name"]').text()).toBe(
      'CaseStatusUpdated'
    )
    expect(link.hasClass('text-sm')).toBe(true)
    expect(link.hasClass('font-semibold')).toBe(true)
    expect(classOf(link)).not.toContain('font-mono')
    expect(classOf(link)).not.toContain('text-base-content/')
  })

  // PascalCase to see, and — since many rows share a name — the spaced name
  // plus the id to hear, so every row's link has a name of its own.
  test('names the link with the spoken name and the id', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="event-link"]')
    const name = $('[data-testid="event-type-name"]')
    const spoken = $('[data-testid="event-link-name"]')

    expect(name.attr('aria-hidden')).toBe('true')
    expect(spoken.text()).toBe(
      `Case status updated, event 3f2c1a0e-1111-2222-3333-444455556666`
    )
    expect(spoken.hasClass('sr-only')).toBe(true)
    expect(link.attr('title')).toBeUndefined()
    expect(link.attr('aria-label')).toBeUndefined()
  })

  test("gives every row's link a name of its own", async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const names = $('[data-testid="event-link-name"]')
      .toArray()
      .map((name) => $(name).text())

    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(3)
    $('[data-testid="event-row"]')
      .toArray()
      .forEach((row) => {
        expect($(row).find('[data-testid="event-link-name"]').text()).toContain(
          $(row).find('[data-testid="event-id"]').text()
        )
      })
  })

  // The id under the name: plain muted mono, whole and selectable, and not a
  // second link.
  test('sets the id under the name, as muted mono text', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.is('a')).toBe(false)
    expect(id.find('a')).toHaveLength(0)
    expect(id.hasClass('font-mono')).toBe(true)
    expect(id.hasClass('text-sm')).toBe(true)
    expect(id.hasClass('text-base-content/70')).toBe(true)
    expect(id.hasClass('font-semibold')).toBe(false)
  })

  // The service in the Service filter's own words, and the box in words:
  // plain text, no titles, and no hop joining them.
  test('says the service and the box in their own columns, with no title', async () => {
    const { $ } = await viewPage()

    const cells = $('[data-testid="event-row"]').first().find('> td')

    expect(flatten(cells.eq(1).text())).toBe('GAS')
    expect(flatten(cells.eq(2).text())).toBe('Outbox')
    for (const testId of ['event-service', 'event-box']) {
      expect($(`[data-testid="${testId}"]`).attr('title')).toBeUndefined()
      expect($(`[data-testid="${testId}"]`).find('a')).toHaveLength(0)
    }
    expect($('[data-testid="event-hop"]')).toHaveLength(0)
    expect($('[data-testid="event-queue"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]').text()).not.toContain('GAS Outbox')
    expect($('main').html()).not.toContain('gas__sns__update_case_status_fifo')
  })

  // Caseworking reads CW-BE here, in the column, on the trigger and in its
  // menu alike; the wire value does not move.
  test('says a Caseworking inbox row as CW-BE and Inbox', async () => {
    givenEvents([event({ ...inbox, service: 'caseworking', hop: 'CW Inbox' })])

    const { $ } = await viewPage('/dev-ops/events?service=caseworking')

    expect($('[data-testid="event-service"]').text()).toBe('CW-BE')
    expect($('[data-testid="event-box"]').text()).toBe('Inbox')
    expect(
      flatten($('[data-testid="events-filter-service-button"]').text())
    ).toBe('Service: CW-BE')
    expect(
      flatten(segmentFor($, 'events-filter-service-chip', 'caseworking').text())
    ).toBe('CW-BE')
    // The subtitle keeps the endpoint's word.
    expect($('[data-testid="events-subtitle"]').text()).toContain('Caseworking')
  })

  // A service or box this page has no word for is drawn as it was sent.
  test('draws an unknown service or box as the endpoint sent it', async () => {
    givenEvents([
      event({
        service: 'reporting' as unknown as EventRow['service'],
        box: 'archive' as unknown as EventRow['box'],
        hop: 'reporting Archive'
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-service"]').text()).toBe('reporting')
    expect($('[data-testid="event-box"]').text()).toBe('archive')
  })

  test('shows the whole event id, unshortened', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.text()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(id.text()).not.toContain('…')
  })

  test('shows no segregation reference anywhere in the table', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]').text()).not.toContain('reference')
  })

  test('sets the identity cell as the name link with the id beneath it', async () => {
    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] > td').eq(0)

    expect(cell.find('> a').attr('data-testid')).toBe('event-link')
    expect(cell.find('> div')).toHaveLength(1)
    expect(cell.find('> div').attr('data-testid')).toBe('event-id')
    expect(flatten(cell.find('> div').text())).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
  })

  test('names an audit row from the label the endpoint gave it', async () => {
    givenEvents([event({ type: 'audit' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-type-name"]').text()).toBe('AuditRecord')
    expect($('[data-testid="event-link-name"]').text()).toBe(
      `Audit record, event 3f2c1a0e-1111-2222-3333-444455556666`
    )
    expect($('[data-testid="event-id"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
    expect($('[data-testid="event-row"]').text()).not.toContain('n/a')
  })

  // Navigation, not a search: Mongo's unique constraint means `?q=<id>` could
  // only ever answer with the row already on screen.
  test("links the name at the event's own page, and never at a search", async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const link = $('[data-testid="event-link"]')

    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b?from=' +
        encodeURIComponent('?status=DEAD_LETTER')
    )
    expect(link.attr('href')).not.toContain('?q=')
  })

  test('says nothing about searching by id anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($.html()).not.toContain('Show every event with this id')
  })

  test('offers no copy button anywhere in the table', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-row"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
    expect(
      $('[data-testid="events-table"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
  })

  test('shows how long ago the row was created', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-created-at"]')
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim()
    ).toBe('20m ago')
  })

  // The absolute instant is the one value on the row worth quoting, and it
  // lived only on a `title` - which a keyboard or a touch user never sees.
  test('reads the absolute instant out for anyone who cannot hover', async () => {
    const { $ } = await viewPage()

    const absolute = $('[data-testid="event-created-absolute"]')

    expect(absolute.text().trim()).toBe('(2026-06-16T10:00:00Z)')
    expect(absolute.attr('class')).toContain('sr-only')
  })

  test('carries the absolute time in the title of the relative one', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-created-at"]').attr('title')).toBe(
      '2026-06-16T10:00:00Z'
    )
  })

  test('underlines no timestamp and marks none of them as hoverable', async () => {
    givenEvents([event({ ...completed, latency: '1.2s' })])

    const { $ } = await viewPage()

    const classes = [
      $('[data-testid="event-created-at"]').attr('class'),
      $('[data-testid="event-latency"]').attr('class')
    ]

    expect(classes.some((value) => value?.includes('do-timestamp'))).toBe(false)
    expect($('main').html()).not.toContain('do-timestamp')
  })

  test('carries no red at all on a page with nothing wrong on it', async () => {
    givenEvents([event({ ...completed })])

    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').html()).not.toContain('text-error')
    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
  })

  // One red per row, and the status dot is it.
  test('leaves colour to the status dot, even on a dead letter', async () => {
    givenEvents([event({ ...deadLettered })])

    const { $ } = await viewPage()

    const cells = $('[data-testid="event-row"]')
      .first()
      .find('td')
      .toArray()
      .map((cell) => $(cell).html())
      .join('')

    expect(cells).not.toContain('text-error')
    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-error'
    )
  })

  test('washes a dead letter row, and leaves every other row plain', async () => {
    givenEvents([event(deadLettered), event(failed)])

    const { $ } = await viewPage()

    const classes = $('[data-testid="event-row"]')
      .toArray()
      .map((row) => $(row).attr('class'))

    expect(classes).toEqual([deadLetterRowClass, rowClass])
  })

  test('leaves the summary of a healthy group unwashed', async () => {
    givenEvents([
      event({ ...completed, id: 'a', eventId: 'a' }),
      event({ ...completed, id: 'b', eventId: 'b' })
    ])

    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('bg-error/5')
  })

  test('reads an outbox row as its service and box, and nothing more', async () => {
    const { $ } = await viewPage()

    const cells = $('[data-testid="event-row"]').first().find('> td')
    const text = flatten(cells.eq(1).text() + ' ' + cells.eq(2).text())

    expect(text).toBe('GAS Outbox')
    expect(text).not.toContain('to Caseworking')
    expect(text).not.toContain('→')
  })

  test('carries no service filter link on any row of the table', async () => {
    givenEvents([event(), event({ ...deadLettered, id: 'b', eventId: 'b-2' })])

    const { $ } = await viewPage()

    const hrefs = $('[data-testid="events-table"] a')
      .toArray()
      .map((link) => $(link).attr('href') ?? '')

    expect(hrefs.some((href) => href.includes('service='))).toBe(false)
  })

  test('names an audit row by its id, with its name under it', async () => {
    givenEvents([
      event({
        eventId: '665f1c2e9a1b2c3d4e5f6a7b',
        type: 'audit',
        queue: 'to Audit',
        queueValue: 'gas__sns__audit_fifo'
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-id"]').text()).toBe(
      '665f1c2e9a1b2c3d4e5f6a7b'
    )
    expect($('[data-testid="event-type-name"]').text()).toBe('AuditRecord')
    expect($('[data-testid="event-service"]').text()).toBe('GAS')
    expect($('[data-testid="event-box"]').text()).toBe('Outbox')
  })

  // The page names whatever label the endpoint sends. `unknown` is the label
  // for a record that stores no type and is not an audit record — an anomaly
  // worth seeing, not noise.
  test.each([
    ['audit', 'AuditRecord'],
    ['unknown', 'NoTypeRecorded'],
    ['case.status.updated', 'CaseStatusUpdated']
  ])('names the %s label like any other type', async (type, name) => {
    givenEvents([event({ type })])

    const { $ } = await viewPage()

    const link = $('[data-testid="event-link"]')

    expect(link.find('[data-testid="event-type-name"]').text()).toBe(name)
    expect(link.hasClass('font-semibold')).toBe(true)
  })

  test('keeps an audit row openable through its name', async () => {
    givenEvents([event({ eventId: '665f1c2e9a1b2c3d4e5f6a7b', type: 'audit' })])

    const { $ } = await viewPage()

    const link = $('[data-testid="event-link"]')

    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toContain('/dev-ops/events/gas/outbox/')
  })

  // The raw type is the detail page's Type fact to show; the row names the
  // event and nothing more, on hover or otherwise.
  test('shows the raw type nowhere on the row', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').html()).not.toContain(
      'case.status.updated'
    )
    expect($('[data-testid="event-link"]').attr('title')).toBeUndefined()
  })

  test('marks a dead letter row red and washes the row it sits on', async () => {
    givenEvents([event({ ...deadLettered })])

    const { $ } = await viewPage()

    const badge = $('[data-testid="do-status-badge"]')

    expect(badge.find('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-error'
    )
    expect(badge.text().trim()).toBe('Dead letter')
    expect(badge.attr('title')).toBe('DEAD_LETTER')
    expect($('[data-testid="do-status-label"]').attr('class')).toContain(
      'font-medium'
    )
    expect($('[data-testid="event-row"]').attr('class')).toBe(
      deadLetterRowClass
    )
    expect(flatten($('[data-testid="event-status"]').text())).toBe(
      'Dead letter'
    )
  })

  test('carries no DLQ chip anywhere', async () => {
    givenEvents([event(deadLettered)])

    const { $ } = await viewPage()

    expect($('[data-testid="event-dlq"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('DLQ')
  })

  test('leaves a completed row untreated', async () => {
    givenEvents([event(completed)])

    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
    expect($('main').html()).not.toContain('bg-error/5')
  })

  test('leaves a row in neither state untreated', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
  })

  // Where the page sticks the table is the card's width; below that it keeps
  // its 64rem minimum and scrolls sideways. Its header row pins under the
  // sticky top rather than at the top of the window.
  test('keeps the table on daisyUI classes, full width where the page sticks', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toBe(
      'table table-pin-rows w-full min-w-[64rem] table-fixed [@media(min-width:64rem)_and_(min-height:40rem)]:min-w-0 [@media(min-width:64rem)_and_(min-height:40rem)]:[&_thead]:top-[var(--sticky-top,15rem)]'
    )
  })

  test('dots a published row quietly', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain('status')
  })

  test('dots a processing row as in flight', async () => {
    givenEvents([
      event({
        status: 'PROCESSING',
        statusLabel: 'Processing',
        statusRole: 'info',
        statusRetrying: false
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-info'
    )
  })

  test('dots a retrying row amber and keeps the retry glyph', async () => {
    givenEvents([event(failed)])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-warning'
    )
    expect($('[data-testid="do-status-badge"]').text().trim()).toBe('Failed ↻')
  })

  test('holds a completed row back without changing its anatomy', async () => {
    givenEvents([event(completed)])

    const { $ } = await viewPage()

    const status = $('[data-testid="do-status-badge"]')

    expect(status.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-success'
    )
    expect($('[data-testid="do-status-label"]').attr('class')).toContain(
      'text-base-content/70'
    )
    expect(status.text().trim()).toBe('Completed')
    expect(status.attr('title')).toBe('COMPLETED')
  })

  test('gives every status the same dot-and-label anatomy, and no pill', async () => {
    givenEvents([
      event({ id: 'a', eventId: 'a' }),
      event({
        id: 'b',
        eventId: 'b',
        status: 'PROCESSING',
        statusLabel: 'Processing',
        statusRole: 'info',
        statusRetrying: false
      }),
      event({ ...failed, id: 'c', eventId: 'c' }),
      event({ ...deadLettered, id: 'd', eventId: 'd' }),
      event({ ...completed, id: 'e', eventId: 'e' })
    ])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="do-status-dot"]')
        .toArray()
        .map((dot) => $(dot).attr('class'))
    ).toEqual([
      'status',
      'status status-info',
      'status status-warning',
      'status status-error',
      'status status-success'
    ])
    expect($('main').html()).not.toContain('do-badge')
    expect($('main').html()).not.toContain('do-status-quiet')
  })

  test('dots a status it does not know quietly and still shows it', async () => {
    givenEvents([
      event({
        status: 'QUARANTINED',
        statusLabel: 'QUARANTINED',
        statusRole: 'neutral',
        statusRetrying: false
      })
    ])

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="do-status-dot"]').attr('class')).toBe('status')
    expect($('[data-testid="do-status-badge"]').text()).toContain('QUARANTINED')
  })

  // The attempt count is the detail page's now. On a list it repeated the
  // badge on nearly every row, and on the rows where it did not - the dead
  // letters - the badge had already said it.
  test('counts no attempts anywhere on the list, on any status', async () => {
    givenEvents([
      event({ ...deadLettered }),
      event({ ...failed, id: 'b', eventId: 'b-1111-2222-3333-444455556666' }),
      event({ ...completed, id: 'c', eventId: 'c-1111-2222-3333-444455556666' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]')).toHaveLength(3)
    for (const testId of [
      'event-failure',
      'event-attempts',
      'event-last-failure'
    ]) {
      expect($(`[data-testid="${testId}"]`)).toHaveLength(0)
    }
    expect($('[data-testid="events-table"]').text()).not.toContain('attempts')
  })

  test('names no column for failures or attempts at all', async () => {
    const { $ } = await viewPage()

    const labels = headings($)
      .toArray()
      .map((cell) => $(cell).text().trim())

    expect(labels).not.toContain('Failure')
    expect(labels).not.toContain('Attempts')
    expect(labels).not.toContain('Last failure')
    expect($('[data-testid="event-failure-cell"]')).toHaveLength(0)
    expect($('[data-testid="event-attempts-cell"]')).toHaveLength(0)
    expect($('[data-testid="event-last-failure-cell"]')).toHaveLength(0)
  })

  // Why a row failed is its own page's to say, and the Top errors panel's
  // across the dead letters: under every row it was a column of near-identical
  // red lines.
  test('leaves why the last attempt failed off the row', async () => {
    givenEvents([failing('connect ETIMEDOUT 10.0.3.14:443')])

    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]')).toHaveLength(1)
    expect($('[data-testid="event-error"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]').text()).not.toContain('ETIMEDOUT')
  })

  test('says nothing at all under the status of a row that never failed', async () => {
    const { $ } = await viewPage()

    const status = $('[data-testid="event-status"]')

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
    expect($('[data-testid="event-attempts"]')).toHaveLength(0)
    expect(flatten(status.text())).toBe('Published')
    expect(status.children()).toHaveLength(1)
  })

  // Deliberately no trace link on a list row: following a trace is a question
  // about one event, asked on that event's own page.
  test('renders no trace link on a list row, however many rows there are', async () => {
    givenLogsExplorer()
    givenEvents([event({ id: '1' }), event({ id: '2' }), event({ id: '3' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]').text()).not.toContain('trace')
    expect($.html()).not.toContain('data-explorer')
  })

  // The cell shows the whole id, and the link's spoken name says it again —
  // a hostile string has to arrive as text in both.
  test("escapes an event id containing markup, in the cell and in the link's name", async () => {
    givenEvents([event({ eventId: xss })])

    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.find('script')).toHaveLength(0)
    expect(id.text()).toBe(xss)
    // ...and in the link's spoken name, which says the id too.
    expect(escapingOf($, 'event-link').scripts).toBe(0)
    expect($('[data-testid="event-link-name"]').text()).toContain(xss)
    expect($('script')).toHaveLength(1)
  })

  test('escapes a type containing markup', async () => {
    givenEvents([event({ type: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-type-name')).toEqual(rendersAsText)
  })

  test('escapes a status containing markup', async () => {
    givenEvents([event({ status: xss, statusLabel: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'do-status-badge')).toEqual(rendersAsText)
  })

  // The alert names the hop the endpoint named, so a hostile one reaches the
  // banner as a whole string rather than being assembled from two here.
  test('escapes an unavailable source name containing markup', async () => {
    givenEvents([event()], {}, [
      {
        service: 'gas',
        box: 'inbox',
        hop: `${xss} Inbox`,
        message: 'timeout'
      }
    ])

    const { $ } = await viewPage()

    expect(escapingOf($, 'events-partial')).toEqual(rendersAsText)
  })

  test('never renders a script the endpoint sent, anywhere on the page', async () => {
    givenEvents(
      [
        event({
          eventId: xss,
          type: xss,
          hop: xss,
          queue: `to ${xss}`,
          queueValue: xss,
          status: xss,
          statusLabel: xss
        })
      ],
      {},
      [{ service: 'gas', box: 'inbox', hop: xss, message: xss }]
    )

    const { $ } = await viewPage()

    // The layout's own module script is the only one a correct page carries.
    expect($('script')).toHaveLength(1)
    expect($('script').attr('type')).toBe('module')
  })

  test('keeps the status filter on the next page', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-load-more"]').attr('data-next-page')).toBe(
      '/dev-ops/events?cursor=END&status=DEAD_LETTER'
    )
  })

  test('omits the pager when there are no events', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(0)
  })

  test('counts nothing in the footer', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-count"]')).toHaveLength(0)
    expect($('[data-testid="do-pager"]').text()).not.toContain('event')
    expect($('[data-testid="do-pager"]').text()).not.toContain('group')
  })

  test('names the unavailable sources when Caseworking is not configured', async () => {
    givenEvents([event()], {}, [
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

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]').text().trim()).toBe(
      'Some event sources are unavailable: CW Inbox, CW Outbox. Showing the rest.'
    )
    expect($('[data-testid="event-row"]')).toHaveLength(1)
  })

  test('names a GAS source when one GAS read failed', async () => {
    givenEvents([event(inbox), event()], {}, [
      {
        service: 'gas',
        box: 'outbox',
        hop: 'GAS Outbox',
        message: 'read error'
      }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]').text()).toContain('GAS Outbox')
    expect($('[data-testid="event-row"]')).toHaveLength(2)
  })

  test('keeps loading on a partial page', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true }, [
      {
        service: 'caseworking',
        box: 'inbox',
        hop: 'CW Inbox',
        message: 'timeout'
      }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]')).toHaveLength(1)
    expect($('[data-testid="events-load-more"]').attr('data-next-page')).toBe(
      '/dev-ops/events?cursor=END'
    )
  })

  test('shows the error alert when the page could not be read', async () => {
    givenUnavailable()

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="events-error"]').text().trim()).toBe(
      'Events could not be loaded from GAS.'
    )
    expect($('[data-testid="events-table"]')).toHaveLength(0)
  })

  test('marks each alert with its own icon', async () => {
    givenEvents([event()], {}, [
      {
        service: 'caseworking',
        box: 'inbox',
        hop: 'CW Inbox',
        message: 'not configured'
      }
    ])

    const { $ } = await viewPage()

    expect(
      $(
        '[data-testid="events-partial"] [data-testid="do-icon-exclamation-triangle"]'
      )
    ).toHaveLength(1)

    givenUnavailable()

    const { $: $error } = await viewPage()

    expect(
      $error(
        '[data-testid="events-error"] [data-testid="do-icon-exclamation-circle"]'
      )
    ).toHaveLength(1)
  })

  test('tells the user when there are no events', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="events-empty"]').text().trim()).toBe(
      'No events found.'
    )
    expect($('[data-testid="do-pager"]')).toHaveLength(0)
    expect($('[data-testid="events-error"]')).toHaveLength(0)
    expect($('[data-testid="events-partial"]')).toHaveLength(0)
  })

  test('keeps the empty message inside the table card', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="events-card"] [data-testid="events-empty"]')
    ).toHaveLength(1)
  })

  // `No events found.` under a needle the operator typed reads as "this
  // service has no events", which is a far more alarming sentence than the
  // true one.
  test('names the search that found nothing, and offers to clear it', async () => {
    givenEvents([])

    const { $ } = await viewPage('/dev-ops/events?service=gas&q=gld-9b2')

    expect(flatten($('[data-testid="events-empty"]').text())).toBe(
      'No events match "gld-9b2". Clear search'
    )
    expect($('[data-testid="events-empty-clear"]').attr('href')).toBe(
      '/dev-ops/events?service=gas'
    )
  })

  test('offers nothing to clear on an empty page that is not a search', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="events-empty-clear"]')).toHaveLength(0)
  })

  // An outage is a state of the result set, so it is reported inside the
  // frame the result set lives in.
  test('reports an outage inside the same card frame', async () => {
    givenUnavailable()

    const { $ } = await viewPage()

    const card = $('[data-testid="events-card"]')

    expect(card).toHaveLength(1)
    expect(card.attr('class')).toContain('flex-1')
    expect(card.find('[data-testid="events-error"]')).toHaveLength(1)
    expect($('[data-testid="events-empty"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]')).toHaveLength(0)
    expect(
      $('[data-testid="events-toolbar"]').find('[data-testid="events-error"]')
    ).toHaveLength(0)
  })

  // The document scrolls and the table is as tall as its rows: no inner
  // scroller, no locked frame. Sideways only, and only below the sticky
  // breakpoint, where the table keeps its minimum width.
  test('scrolls the page, not a box around the table', async () => {
    const { $ } = await viewPage()

    const scroller = $('[data-testid="events-scroller"]')

    expect(scroller.attr('class')).toBe(
      'w-full overflow-x-auto [@media(min-width:64rem)_and_(min-height:40rem)]:overflow-visible'
    )
    expect(scroller.find('[data-testid="events-table"]')).toHaveLength(1)
    expect(classOf($('body'))).toBe('flex min-h-dvh flex-col bg-base-200')
    expect($('main').html()).not.toContain('overflow-y-auto overscroll-contain')
  })

  // The heading, the tiles and the toolbar stick as one opaque block under
  // the navbar, which sticks too — only where the viewport has room.
  test('sticks the top of the page, and the bar above it, where there is room', async () => {
    const { $ } = await viewPage()

    const sticky = $('[data-testid="events-sticky"]')
    const media = '[@media(min-width:64rem)_and_(min-height:40rem)]'

    expect(sticky.is('do-sticky-top')).toBe(true)
    expect(
      sticky
        .children()
        .toArray()
        .map((child) => $(child).attr('data-testid'))
    ).toEqual(['events-heading', 'events-status-tiles', 'events-toolbar'])
    for (const name of [
      `${media}:sticky`,
      `${media}:top-[var(--nav-h,57px)]`,
      `${media}:z-20`,
      'bg-base-200'
    ]) {
      expect(sticky.hasClass(name)).toBe(true)
    }
    expect(sticky.hasClass('sticky')).toBe(false)

    const navbar = $('header.navbar')

    expect(navbar.hasClass(`${media}:sticky`)).toBe(true)
    expect(navbar.hasClass(`${media}:z-30`)).toBe(true)
    expect(navbar.hasClass('sticky')).toBe(false)
    // Focus scrolling clears the sticky top and the pinned header row.
    expect(classOf($('html'))).toBe(
      `${media}:scroll-pt-[calc(var(--sticky-top,15rem)+3rem)]`
    )
  })

  test('keeps the table wide enough for its four columns to scroll', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toContain(
      'min-w-[64rem]'
    )
  })

  // The card clips rather than hiding its overflow: `overflow-hidden` would
  // make it a scroll container, and the table's header row would pin to the
  // card instead of the viewport.
  test('frames the table in a bordered card that grows with its rows', async () => {
    const { $ } = await viewPage()

    const card = $('[data-testid="events-card"]')

    expect(card.attr('class')).toContain('card card-border')
    expect(card.hasClass('bg-base-100')).toBe(true)
    expect(card.hasClass('overflow-clip')).toBe(true)
    expect(card.hasClass('overflow-hidden')).toBe(false)
    expect(card.hasClass('min-h-0')).toBe(false)
    expect(card.find('[data-testid="events-scroller"]')).toHaveLength(1)
  })

  // No pager: the next page loads as the reader nears the bottom, from the
  // loader under the table.
  test('draws no pager, and no Newer or Older, under the table', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Newer')
    expect($('main').text()).not.toContain('Older')
    expect($('main').html()).not.toContain('direction=')
    expect(
      $('[data-testid="events-load-more"]').prev().attr('data-testid')
    ).toBe('events-scroller')
  })

  test('loads the next page from the loader, carrying every filter', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER&q=gld-9b2')

    const loader = $('[data-testid="events-load-more"]')

    expect(loader.is('do-load-more')).toBe(true)
    expect(loader.attr('data-next-page')).toBe(
      '/dev-ops/events?cursor=END&status=DEAD_LETTER&q=gld-9b2'
    )
    expect(loader.attr('data-rows')).toBe('events-rows')
    expect($('[data-testid="events-table"] tbody').attr('id')).toBe(
      'events-rows'
    )
    expect(loader.find('[data-load-more-sentinel]')).toHaveLength(1)
    // Everything the loader can show waits, hidden, until it is needed.
    for (const part of [
      'events-load-more-spinner',
      'events-load-more-end',
      'events-load-more-error',
      'events-load-more-retry'
    ]) {
      expect($(`[data-testid="${part}"]`).attr('hidden')).toBeDefined()
    }
    expect($('[data-testid="events-load-more-spinner"]').attr('class')).toBe(
      'loading loading-spinner loading-sm my-3'
    )
    expect($('[data-testid="events-load-more-status"]').attr('aria-live')).toBe(
      'polite'
    )
  })

  // With no script, the next page is a plain link — and only then.
  test('offers a More link to a page without script', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage('/dev-ops/events?service=gas')

    const noscript = load($('[data-testid="events-load-more"] noscript').text())
    const more = noscript('[data-testid="events-load-more-link"]')

    expect(more.attr('href')).toBe('/dev-ops/events?cursor=END&service=gas')
    expect(flatten(more.text())).toBe('More events')
  })

  test('says No more events on the last page, and offers no More', async () => {
    givenEvents([event()], { hasNextPage: false })

    const { $ } = await viewPage()

    const end = $('[data-testid="events-load-more-end"]')

    expect(end.attr('hidden')).toBeUndefined()
    expect(flatten(end.text())).toBe('No more events')
    expect(end.hasClass('text-base-content/70')).toBe(true)
    expect(
      $('[data-testid="events-load-more"]').attr('data-next-page')
    ).toBeUndefined()
    expect($('[data-testid="events-load-more"] noscript')).toHaveLength(0)
  })

  // Every form on the list is a GET; every write in the app is made from one
  // event's own page.
  test('writes nothing: no post, no select, no row action', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('main select')).toHaveLength(0)
    expect($('main [role="tablist"]')).toHaveLength(0)
    expect($('main form[method="post"]')).toHaveLength(0)
    expect($('main form[method="get"]')).toHaveLength(2)
    expect($('main [form]')).toHaveLength(0)
    // No checkbox anywhere on the list: there is nothing here to select, and
    // the audit switch is a link.
    expect($('main [type="checkbox"]')).toHaveLength(0)
    // Search, the two triggers that open the Time and Service menus, Apply
    // inside the range panel, and the loader's hidden Retry. None of the five
    // writes anything.
    expect(
      $('main button:not([data-testid="do-copy-button-control"])')
    ).toHaveLength(5)
    // The search box and the range panel's two boxes.
    expect($('main input:not([type="hidden"])')).toHaveLength(3)
  })

  // One module, the layout's own, and no handler written into the markup: the
  // copy buttons are custom elements the bundle upgrades.
  test('adds no script and no inline handler of its own', async () => {
    const { $ } = await viewPage()

    expect($('script')).toHaveLength(1)
    expect($('main [onclick]')).toHaveLength(0)
  })

  test('reports source health with the alert alone', async () => {
    givenEvents([event()], {}, [
      {
        service: 'caseworking',
        box: 'inbox',
        hop: 'CW Inbox',
        message: 'not configured'
      }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-heading"]').text()).not.toContain('sources')
    expect($('[data-testid="events-heading"] .badge')).toHaveLength(0)
    expect($('[data-testid="events-partial"]')).toHaveLength(1)
  })

  test('says nothing about a read replica, and floats nothing under the card', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-lag-note"]')).toHaveLength(0)
    expect($('[data-testid="events-rollup"]').text()).not.toContain('secondary')
    expect($('main').text()).not.toContain('may lag')
    expect($('[data-testid="events-footnote"]')).toHaveLength(0)
    expect($('[data-testid="events-card"]').next()).toHaveLength(0)
  })

  test('brands the header with the product and the app', async () => {
    const { $ } = await viewPage()

    const brand = $('[data-testid="do-brand"]')
    const suffix = $('[data-testid="do-brand-suffix"]')

    expect(flatten(`${brand.text()} ${suffix.text()}`)).toBe(
      'Grants Platform · Dev Ops'
    )
    expect(brand.attr('class')).toContain('font-bold')
    expect(brand.attr('href')).toBe('/dev-ops')
    expect(suffix.attr('class')).toContain('text-base-content/70')
    expect(brand.closest('.navbar-start')).toHaveLength(1)
    expect($('header').attr('class')).toContain('navbar')
    expect(brand.text()).not.toContain('fg-grants-platform-admin')
  })

  // Not a daisyUI `link`: hovering the row, or the name, fills the row and
  // underlines nothing.
  test('links the name at the page for that one event, with no underline', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="event-link"]')

    expect(link.is('a')).toBe(true)
    expect(link.attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
    expect(link.hasClass('link')).toBe(false)
    expect(link.hasClass('link-hover')).toBe(false)
    expect(link.hasClass('no-underline')).toBe(true)
    expect($('[data-testid="events-table"]').html()).not.toContain('link-hover')
  })

  test('leaves the id beneath it as plain text, not a second link', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-id"]').is('a')).toBe(false)
    expect($('[data-testid="event-id"]').closest('a')).toHaveLength(0)
  })

  // Every filter, and no cursor: a row reached far down the list sends Back
  // to the top of the same filtered list rather than stranding the operator
  // on a page the list has no way back up from.
  test('carries every filter, and no cursor, onto the row link', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&cursor=END&q=gld-9b2'
    )

    expect($('[data-testid="event-link"]').attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b?from=' +
        encodeURIComponent('?status=DEAD_LETTER&service=gas&q=gld-9b2')
    )
  })

  test('carries no from at all off a list that only held a cursor', async () => {
    const { $ } = await viewPage('/dev-ops/events?cursor=END')

    expect($('[data-testid="event-link"]').attr('href')).not.toContain('from=')
  })

  test('carries no from at all off an unfiltered list', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-link"]').attr('href')).not.toContain('from=')
  })

  test('links every row at its own page', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const links = $('[data-testid="event-row"] [data-testid="event-link"]')

    expect(links).toHaveLength(3)
    links.toArray().forEach((link) => {
      expect($(link).attr('href')).toContain('/dev-ops/events/gas/outbox/')
    })
  })

  test('escapes an event type carrying markup', async () => {
    givenEvents([event({ type: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-type-name')).toEqual(rendersAsText)
  })

  // The whole row opens the event through one link: its `::after` is
  // stretched over the row, which is its positioning context. One tab stop,
  // no script, and a ctrl- or middle-click still opens a tab.
  test("makes the name the row's one link, stretched over the row", async () => {
    const { $ } = await viewPage()

    const row = $('[data-testid="event-row"]').first()
    const link = $('[data-testid="event-link"]')
    const id = $('[data-testid="event-id"]')

    expect(row.find('a')).toHaveLength(1)
    expect(row.find('[onclick], [tabindex]')).toHaveLength(0)
    expect(row.hasClass('relative')).toBe(true)
    expect(row.hasClass('cursor-pointer')).toBe(true)
    expect(link.hasClass('after:absolute')).toBe(true)
    expect(link.hasClass('after:inset-0')).toBe(true)
    // The id is lifted over the overlay so it stays selectable, and only as
    // wide as its own text.
    expect(id.hasClass('relative')).toBe(true)
    expect(id.hasClass('w-fit')).toBe(true)
  })

  // Keyboard focus outlines the row, inset so the scroller cannot clip it,
  // with the hover fill; the link's own ring is off, and a mouse click —
  // which is not `:focus-visible` — shows nothing.
  test('outlines a keyboard-focused row, and not its link', async () => {
    const { $ } = await viewPage()

    const row = $('[data-testid="event-row"]').first()
    const link = $('[data-testid="event-link"]')

    for (const name of [
      'has-[:focus-visible]:outline-2',
      'has-[:focus-visible]:-outline-offset-2',
      'has-[:focus-visible]:outline-base-content',
      'has-[:focus-visible]:bg-base-200'
    ]) {
      expect(row.hasClass(name)).toBe(true)
    }
    expect(link.hasClass('focus-visible:outline-none')).toBe(true)
    expect(
      classOf(link)
        .split(' ')
        .filter((name) => /(^|:)(outline|ring)-(?!none)/.test(name))
    ).toEqual([])
    expect(classOf(row)).not.toContain('focus:')
  })

  test("keeps a dead letter row's own fill for hover and focus", async () => {
    givenEvents([event(deadLettered)])

    const { $ } = await viewPage()

    const row = $('[data-testid="event-row"]')

    expect(row.hasClass('bg-error/5')).toBe(true)
    expect(row.hasClass('hover:bg-error/10')).toBe(true)
    expect(row.hasClass('has-[:focus-visible]:bg-error/10')).toBe(true)
    expect(row.hasClass('has-[:focus-visible]:outline-2')).toBe(true)
    expect(row.hasClass('hover:bg-base-200')).toBe(false)
  })

  test('puts the wall clock under the relative age', async () => {
    const { $ } = await viewPage()

    const clock = $('[data-testid="event-created-clock"]')

    expect(clock.text().trim()).toBe('10:00:00')
    expect(clock.attr('class')).toContain('font-mono')
    expect(clock.attr('class')).toContain('text-sm')
    expect(clock.attr('class')).toContain('text-base-content/70')
    expect(clock.attr('title')).toBe('2026-06-16T10:00:00Z')
  })

  test('dates the wall clock once the row is more than a day old', async () => {
    givenEvents([event({ createdAt: '2026-06-14T08:18:01.000Z' })])

    const { $ } = await viewPage()

    const clock = $('[data-testid="event-created-clock"]')

    expect(flatten(clock.text())).toBe('14 Jun 08:18')
    expect(clock.attr('title')).toBe('2026-06-14T08:18:01Z')
    // No copy button: two spellings are on the row already and the whole
    // instant is a click away on the row's own page.
    expect(clock.find('[data-testid="do-copy-button"]')).toHaveLength(0)
  })

  test('keeps the relative age exactly as it was above it', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-created-at"]')
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim()
    ).toBe('20m ago')
    expect($('[data-testid="event-created-at"]').attr('title')).toBe(
      '2026-06-16T10:00:00Z'
    )
  })

  test('stamps the page with no render time', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-as-at"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('as at')
  })

  test('says which environment the page is showing', async () => {
    const { $ } = await viewPage()

    const badge = $('[data-testid="do-environment"]')

    expect(badge.text().trim()).toBe('local')
    expect(badge.attr('class')).toContain('badge')
    expect(badge.attr('class')).not.toContain('badge-warning')
    expect(badge.attr('title')).toBe('This is the local environment')
    expect(badge.prev().attr('data-testid')).toBe('do-brand-suffix')
    expect(badge.closest('.navbar-start')).toHaveLength(1)
  })

  // Amber only where being wrong is an incident. Everywhere else the badge is
  // a label, not a colour the eye would learn to ignore.
  test.each(['prod', 'production', 'PROD'])(
    'warns in amber when the environment is %s',
    async (label) => {
      config.set('environmentLabel', label)

      const { $ } = await viewPage()

      const badge = $('[data-testid="do-environment"]')

      expect(badge.text().trim()).toBe(label)
      expect(badge.attr('class')).toContain('badge-warning')
    }
  )

  test.each(['dev', 'test', 'local'])(
    'keeps the badge neutral in %s',
    async (label) => {
      config.set('environmentLabel', label)

      const { $ } = await viewPage()

      expect($('[data-testid="do-environment"]').attr('class')).not.toContain(
        'badge-warning'
      )
    }
  )

  // The bar holds the theme switch alone. Signing out is the index page's.
  test('offers no Sign out in the bar, only the theme toggle', async () => {
    const { $ } = await viewPage()

    expect($('header a[href="/auth/logout"]')).toHaveLength(0)
    expect($('header').text()).not.toContain('Sign out')
    expect($('header do-theme-toggle')).toHaveLength(1)
  })

  // md, like every control under it: a taller bar, a larger brand, and the
  // page's own h1 still a step above the brand.
  test("draws the bar at md, under the page's own heading in size", async () => {
    const { $ } = await viewPage()

    expect($('header.navbar').hasClass('min-h-14')).toBe(true)
    expect($('[data-testid="do-brand"]').hasClass('text-lg')).toBe(true)
    expect($('[data-testid="do-brand-suffix"]').hasClass('text-base')).toBe(
      true
    )
    expect($('[data-testid="events-title"]').hasClass('text-xl')).toBe(true)
  })

  test('offers a From and a To box in the range panel', async () => {
    const { $ } = await viewPage()

    const from = $('[data-testid="events-range-from"]')
    const to = $('[data-testid="events-range-to"]')

    expect(from.attr('type')).toBe('datetime-local')
    expect(from.attr('name')).toBe('from')
    expect(from.attr('step')).toBe('1')
    expect(to.attr('type')).toBe('datetime-local')
    expect(to.attr('name')).toBe('to')
    expect(to.attr('step')).toBe('1')
    expect(from.closest('[data-testid="events-range-form"]')).toHaveLength(1)
    expect(from.closest('[data-testid="events-search"]')).toHaveLength(0)
    // `datetime-local` submits a bare wall time; the route reads it as UTC.
    // The page says so nowhere: every instant it draws is UTC.
    expect(flatten($('[data-testid="events-range-from-label"]').text())).toBe(
      'From'
    )
    expect(flatten($('[data-testid="events-range-to-label"]').text())).toBe(
      'To'
    )
    expect(
      flatten($('[data-testid="events-range-absolute-heading"]').text())
    ).toBe('Custom')
    expect(
      $('[data-testid="events-range-absolute-heading"]').hasClass('text-sm')
    ).toBe(true)
    // md boxes at 14px; Apply stays small.
    expect(from.attr('class')).toBe('input w-full font-mono text-sm')
    expect(to.attr('class')).toBe('input w-full font-mono text-sm')
    expect($('[data-testid="events-range-apply"]').hasClass('btn-sm')).toBe(
      true
    )
  })

  test('reads both ends of the range as UTC and forwards them as instants', async () => {
    await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&to=2026-06-16T10:00:30'
    )

    expect(getEventsUseCase).toHaveBeenCalledWith({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:00:30.000Z'
    })
  })

  test('drops a range box that was submitted empty', async () => {
    await viewPage('/dev-ops/events?from=&to=&status=FAILED')

    expect(getEventsUseCase).toHaveBeenCalledWith({ status: 'FAILED' })
  })

  test('forwards a range value it cannot read for the endpoint to refuse', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?from=last%20tuesday')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ from: 'last tuesday' })
  })

  test('holds the range the page is filtered to in the two boxes', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&to=2026-06-16T10:20:00.000Z'
    )

    expect($('[data-testid="events-range-from"]').attr('value')).toBe(
      '2026-06-16T09:00:00'
    )
    expect($('[data-testid="events-range-to"]').attr('value')).toBe(
      '2026-06-16T10:20:00'
    )
  })

  test('opens both range boxes empty on a page with no range on it', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-range-from"]').attr('value')).toBe('')
    expect($('[data-testid="events-range-to"]').attr('value')).toBe('')
    expect($('[data-testid="events-note-range"]')).toHaveLength(0)
  })

  test('says the window on the button and nowhere in the strip', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&status=FAILED&cursor=END'
    )

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'Time: 2026-06-16 09:00 → now'
    )
    expect($('[data-testid="events-note-range"]')).toHaveLength(0)
    expect($('[data-testid="events-note-range-clear"]')).toHaveLength(0)
  })

  test('names the earlier end when only the later one was given', async () => {
    const { $ } = await viewPage('/dev-ops/events?to=2026-06-16T10:00')

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'Time: earliest → 2026-06-16 10:00'
    )
  })

  test('draws no strip at all on a page narrowed only by its window', async () => {
    const { $ } = await viewPage('/dev-ops/events?from=2026-06-16T09:00')

    expect($('[data-testid="events-filter-notes"]')).toHaveLength(0)
  })

  test('keeps the range on every filter segment', async () => {
    const { $ } = await viewPage('/dev-ops/events?from=2026-06-16T09:00')

    expect(
      segmentFor($, 'events-status-tile', 'DEAD_LETTER').attr('href')
    ).toBe(
      '/dev-ops/events?status=DEAD_LETTER&from=2026-06-16T09%3A00%3A00.000Z'
    )
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('href')
    ).toBe('/dev-ops/events?service=gas&from=2026-06-16T09%3A00%3A00.000Z')
  })

  // The window travels through a search as hidden fields, `range` with it, or
  // the button would forget which rung it is on.
  test('carries the window and its label through a search', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-15T10:19:57.000Z&range=24h'
    )

    const hidden = $('[data-testid="events-search-filter"]')
      .toArray()
      .map((field) => [$(field).attr('name'), $(field).attr('value')])

    expect(hidden).toContainEqual(['from', '2026-06-15T10:19:57.000Z'])
    expect(hidden).toContainEqual(['range', '24h'])
  })

  // The absolute form carries the search but never the window or its label:
  // applying a window of your own is what stops the page being `Last 24h`.
  test('carries the search through an absolute range, and no label with it', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?q=gld-9b2&status=DEAD_LETTER&from=2026-06-15T10:19:57.000Z&range=24h'
    )

    const hidden = $('[data-testid="events-range-filter"]')
      .toArray()
      .map((field) => [$(field).attr('name'), $(field).attr('value')])

    expect(hidden).toContainEqual(['q', 'gld-9b2'])
    expect(hidden).toContainEqual(['status', 'DEAD_LETTER'])
    expect(hidden.map(([name]) => name)).not.toContain('range')
    expect(hidden.map(([name]) => name)).not.toContain('from')
    expect(hidden.map(([name]) => name)).not.toContain('to')
  })

  test('offers no batch redrive anywhere on a page of dead letters', async () => {
    givenEvents([
      event({ id: '665f1c2e9a1b2c3d4e5f6a7b', status: 'DEAD_LETTER' }),
      event({ id: '665f1c2e9a1b2c3d4e5f6a7c', status: 'COMPLETED' })
    ])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="event-select"]')).toHaveLength(0)
    expect($('[data-testid="events-batch-form"]')).toHaveLength(0)
    expect($('[data-testid="events-redrive-selected"]')).toHaveLength(0)
    expect($('[data-testid="events-redrive-all"]')).toHaveLength(0)
    expect($('[data-testid="events-toolbar-actions"]')).toHaveLength(0)
    expect($('main').html()).not.toContain('redrive-batch')
    expect($('main').html()).not.toContain('redrive-query')
    expect($('[data-testid="event-link"]').first().attr('href')).toContain(
      '/dev-ops/events/gas/outbox/'
    )
  })

  test('reports how long a completed row took', async () => {
    givenEvents([event({ ...completed, latency: '1.2s' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-latency"]').text().trim()).toBe('took 1.2s')
  })

  // The two halves of the pattern are timed between different pairs of
  // instants, and one tooltip saying `created to completed` was true of
  // neither in the words an operator would use.
  test.each([
    [
      'inbox',
      { ...inbox, ...completed, latency: '430ms' },
      'Received to completed'
    ],
    ['outbox', { ...completed, latency: '430ms' }, 'Queued to delivered to SNS']
  ] as const)(
    'says what the %s latency is measured between',
    async (_box, overrides, title) => {
      givenEvents([event(overrides)])

      const { $ } = await viewPage()

      expect($('[data-testid="event-latency"]').attr('title')).toBe(title)
    }
  )

  test('says nothing about latency on a row that has not completed', async () => {
    givenEvents([event({ latency: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-latency"]')).toHaveLength(0)
  })

  // Every instant this page draws is UTC, so it says so nowhere. The whole
  // page is swept, attributes included; the only `UTC` left is the formatters'
  // `timeZone` and the trailing `Z` on an ISO value — format, not label.
  test('writes no UTC label anywhere on the page', async () => {
    givenBreakdown([group()], {}, [event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&to=2026-06-16T10:00&q=gld-9b2'
    )

    // The range panel, the clock line and the strip are all in this markup.
    expect($('main').html()).not.toContain('UTC')
    expect($('[data-testid="events-range-panel"]').html()).not.toContain('UTC')
  })

  test('draws the wall clock bare, with the instant on its title', async () => {
    const { $ } = await viewPage()
    const clock = $('[data-testid="event-created-clock"]')

    expect(clock.text().trim()).toBe('10:00:00')
    expect(clock.attr('title')).toBe('2026-06-16T10:00:00Z')
  })

  test('offers no reload controls at all', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-refresh"]')).toHaveLength(0)
    expect($('[data-testid="events-live"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Refresh')
    expect($('main').text()).not.toContain('Auto')
  })

  // No failures panel, no header row: the card starts at the table rather
  // than under an empty bar.
  test('draws no card header on a page with no Top errors', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-card-header"]')).toHaveLength(0)
    expect(
      $('[data-testid="events-card"]').children().first().attr('data-testid')
    ).toBe('events-scroller')
  })

  test('puts no meta refresh in the head', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect($('meta[http-equiv="refresh"]')).toHaveLength(0)
  })

  test('threads no reload parameter through its links or its hidden fields', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect(
      segmentFor($, 'events-status-tile', 'DEAD_LETTER').attr('href')
    ).toBe('/dev-ops/events?status=DEAD_LETTER')
    expect(
      $('[data-testid="events-search-filter"]')
        .toArray()
        .map((field) => [$(field).attr('name'), $(field).attr('value')])
    ).toEqual([['status', 'FAILED']])
    expect($('main').html()).not.toMatch(/[?&]live=/)
  })

  test('refuses a reload parameter left over on a bookmarked url', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/events?live=30&status=FAILED'
    )

    expect(statusCode).toBe(400)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  // The list is one keyset window ordered by time; the shape of an incident
  // is spread across three hundred pages of it. Folded even on a page about
  // dead letters: the summary announces it, the operator opens it.
  test('sits the failures panel directly above the table, folded even on a dead-letter page', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')
    const children = $('[data-testid="events-card"] > *')
      .toArray()
      .map((child) => $(child).attr('data-testid'))

    expect(children).toEqual([
      'events-card-header',
      'events-scroller',
      'events-load-more'
    ])
    expect($('[data-testid="events-failures"]').attr('open')).toBeUndefined()
    expect(
      $('[data-testid="events-card-header"]')
        .next()
        .find('[data-testid="events-table"]')
    ).toHaveLength(1)
  })

  // The disclosure is only as wide as its own words, so the rest of the row
  // toggles nothing — and nothing else sits on it.
  test('keeps the card header to the failures summary alone', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const header = $('[data-testid="events-card-header"]')
    const summary = $('[data-testid="events-failures-summary"]')

    expect(header.attr('class')).toContain('shrink-0')
    expect(header.children()).toHaveLength(1)
    expect(header.children().first().attr('data-testid')).toBe(
      'events-failures'
    )
    expect($('[data-testid="events-card-aside"]')).toHaveLength(0)
    // The disclosure stops at its own words, and the chevron is the last of
    // them rather than an arrow pinned to the far edge.
    expect(classOf(summary)).toContain('w-fit')
    expect(classOf($('[data-testid="events-failures"]'))).not.toContain(
      'collapse-arrow'
    )
    expect(summary.children().last().attr('data-testid')).toBe(
      'do-icon-chevron-down'
    )
  })

  // The panel is fed by the breakdown and nothing else: a failed counts read
  // must not take it down too.
  test('keeps the failures panel on a page whose counts could not be read', async () => {
    vi.mocked(getEventsUseCase).mockResolvedValue({
      page: {
        events: [event(deadLettered)],
        pagination: pagination(),
        sourceErrors: []
      },
      statuses,
      services,
      facets: null,
      breakdown: { groups: [group()], sourceErrors: [] },
      unavailable: false
    })

    const { $ } = await viewPage()

    expect($('[data-testid="events-failures"]')).toHaveLength(1)
    expect($('[data-testid="events-failure-row"]')).toHaveLength(1)
    // The figures are still gone, which is the part that did fail.
    expect(segments($, 'events-status-tile')[0]).toBe('All —')
  })

  // Folded shut it is one line and still keeps its own summary: worth
  // announcing, not worth pushing the table down for.
  test('keeps the panel to its own summary line while it is folded', async () => {
    givenBreakdown([group()], {}, [event()])

    const { $ } = await viewPage()

    const panel = $('[data-testid="events-failures"]')

    expect(panel.attr('open')).toBeUndefined()
    expect(flatten($('[data-testid="events-failures-summary"]').text())).toBe(
      'Top errors (1 group)'
    )
    expect(panel.parent().attr('data-testid')).toBe('events-card-header')
    expect(panel.parent().attr('class')).toContain('border-b')
    expect(panel.attr('class')).not.toContain('border-b')
  })

  test('folds the failures panel shut on an unfiltered page with dead letters behind it', async () => {
    givenBreakdown([group()], {}, [event()])

    const { $ } = await viewPage()

    expect($('[data-testid="events-failures"]')).toHaveLength(1)
    expect($('[data-testid="events-failures"]').attr('open')).toBeUndefined()
    expect(flatten($('[data-testid="events-failures-summary"]').text())).toBe(
      'Top errors (1 group)'
    )
  })

  test('draws no failures panel when the breakdown could not be read', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-failures"]')).toHaveLength(0)
    expect($('[data-testid="events-card"]')).toHaveLength(1)
  })

  test('says each failure, its type, its count and its span', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    // As it is seen: the spoken copy of the name is for a screen reader.
    const row = $('[data-testid="events-failure-row"]').clone()

    row.find('.sr-only').remove()

    expect(flatten(row.text())).toBe(
      'E11000 duplicate key error collection: gas.events index: eventId_1 CaseStatusUpdated 4,182 1d ago 4m ago'
    )
  })

  // The two tables sit stacked in one card, so they are drawn at one size:
  // a cell padding of its own put the panel's first column a few pixels off
  // the Event column below it, which reads as a wonky edge. Both md.
  test('draws the failures table at the same size as the events table', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    for (const id of ['events-failures-table', 'events-table']) {
      const table = $(`[data-testid="${id}"]`)

      expect(table.hasClass('table')).toBe(true)
      expect(table.hasClass('table-sm')).toBe(false)
      expect(table.hasClass('table-xs')).toBe(false)
    }
  })

  // The First and Last headers name the two columns; repeating the word in
  // every cell under them said it twice and made the figures harder to scan.
  // The fuller spelling stays on each cell's own title.
  test('leaves the naming of the span columns to their headers', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const first = $('[data-testid="events-failure-first"]')
    const last = $('[data-testid="events-failure-last"]')

    expect(first.text().trim()).toBe('1d ago')
    expect(last.text().trim()).toBe('4m ago')
    expect(first.attr('title')).toBeDefined()
    expect(last.attr('title')).toBeDefined()

    const headers = $('[data-testid="events-failures-table"] thead th')
      .toArray()
      .map((cell) => $(cell).text().trim())

    expect(headers).toContain('First')
    expect(headers).toContain('Last')
  })

  test('links each failure row at the page narrowed to that failure', async () => {
    givenBreakdown()

    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&cursor=END'
    )

    // The link is the message cell — the one that names the failure.
    expect($('[data-testid="events-failure-message"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+eventId_1'
    )
    expect($('[data-testid="events-failure-row"]').is('tr')).toBe(true)
  })

  // Named as the rows name it, with the raw type on the title.
  test('names an audit group in the failures panel as the rows do', async () => {
    givenBreakdown([group({ type: 'audit' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const type = $('[data-testid="events-failure-type"]')

    expect(type.find('[aria-hidden="true"]').text()).toBe('AuditRecord')
    expect(type.find('.sr-only').text()).toBe('Audit record')
    expect(type.attr('title')).toBe('audit')
    expect($('[data-testid="events-failure-row"]').text()).not.toContain('n/a')
  })

  // `?error=` matches a message, and a group with none has nothing to match
  // on - so its Error cell is a plain muted dash that links nowhere, rather
  // than a click through to a page wider than the row it sits on describes.
  // The footnote that used to spell this out under the panel has gone.
  test('draws a failure group with no error as a dash that links nowhere', async () => {
    givenBreakdown([group({ error: null, count: 12 })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const message = $('[data-testid="events-failure-message"]')

    expect(flatten(message.text())).toBe('—')
    expect(message.is('a')).toBe(false)
    expect(message.attr('href')).toBeUndefined()
    expect(message.attr('title')).toBeUndefined()
    expect(message.attr('class')).toContain('text-base-content/50')
    expect(message.attr('class')).not.toContain('link')
    expect($('[data-testid="events-failures-note"]')).toHaveLength(0)
  })

  // Only the Error cell steps back: the row is otherwise the same row.
  test('leaves the other cells of a group with no error as they were', async () => {
    givenBreakdown([group({ error: null, count: 12 })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-failure-row"]')).toHaveLength(1)
    expect(
      flatten($('[data-testid="events-failure-type"] [aria-hidden]').text())
    ).toBe('CaseStatusUpdated')
    expect(flatten($('[data-testid="events-failure-count"]').text())).toBe('12')
    expect(flatten($('[data-testid="events-failure-first"]').text())).toBe(
      '1d ago'
    )
    expect(
      $('[data-testid="events-failure-first"]').attr('title')
    ).toBeDefined()
  })

  test('keeps a whole failure message on the row title, cut only on the page', async () => {
    const long = `${'x'.repeat(120)}!`

    givenBreakdown([group({ error: long })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')
    const message = $('[data-testid="events-failure-message"]')

    expect(message.text()).toBe(`${'x'.repeat(90)}…`)
    expect(message.attr('title')).toBe(long)
  })

  test('renders a hostile failure message as text', async () => {
    givenBreakdown([group({ error: xss })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect(escapingOf($, 'events-failure-message')).toEqual(rendersAsText)
  })

  test('says which failure the page is narrowed to, above the table', async () => {
    const { $ } = await viewPage(errorFiltered)

    const note = $('[data-testid="events-note-error"]')

    expect(flatten(note.text())).toBe(`Error: "${errorMessage}"`)
    expect(note.find('[title]').attr('title')).toBe(errorMessage)
    expect(note.closest('[data-testid="events-filter-notes"]')).toHaveLength(1)
  })

  test('offers the way out of a failure filter', async () => {
    const { $ } = await viewPage(`${errorFiltered}&service=gas`)

    expect($('[data-testid="events-note-error-clear"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas'
    )
  })

  test('mentions no failure filter on a page that is not narrowed to one', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-note-error"]')).toHaveLength(0)
  })

  test('forwards the failure to the backend as the operator received it', async () => {
    await viewPage(errorFiltered)

    expect(getEventsUseCase).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DEAD_LETTER', error: errorMessage })
    )
  })

  // An empty needle is not a filter, and the endpoint answers 400 for one.
  test('drops an empty failure filter rather than asking for it', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?error=')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith(
      expect.not.objectContaining({ error: expect.anything() })
    )
  })

  test('carries the failure filter through the search form as a hidden field', async () => {
    const { $ } = await viewPage(errorFiltered)

    const fields = $('[data-testid="events-search-filter"]')
      .toArray()
      .map((field) => [$(field).attr('name'), $(field).attr('value')])

    expect(fields).toContainEqual(['error', errorMessage])
  })

  test('renders a hostile failure filter as text', async () => {
    const { $ } = await viewPage(
      `/dev-ops/events?error=${encodeURIComponent(xss)}`
    )

    expect(escapingOf($, 'events-note-error')).toEqual(rendersAsText)
  })

  test('offers the preset ladder, each rung a plain link', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="events-range-preset"]')
        .toArray()
        .map((link) => [flatten($(link).text()), $(link).attr('href')])
    ).toEqual([
      [
        'Last 15m',
        '/dev-ops/events?from=2026-06-16T10%3A05%3A00.000Z&range=15m'
      ],
      ['Last 1h', '/dev-ops/events?from=2026-06-16T09%3A20%3A00.000Z&range=1h'],
      ['Last 6h', '/dev-ops/events?from=2026-06-16T04%3A20%3A00.000Z&range=6h'],
      [
        'Last 24h',
        '/dev-ops/events?from=2026-06-15T10%3A20%3A00.000Z&range=24h'
      ],
      ['Last 7d', '/dev-ops/events?from=2026-06-09T10%3A20%3A00.000Z&range=7d'],
      [
        'Last 30d',
        '/dev-ops/events?from=2026-05-17T10%3A20%3A00.000Z&range=30d'
      ]
    ])
  })

  test('keeps the other filters on a preset, and clears the end of the window', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&to=2026-06-16T10:00:00'
    )

    expect($('[data-testid="events-range-preset"]').first().attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&from=2026-06-16T10%3A05%3A00.000Z&range=15m'
    )
  })

  // ── The control itself ──────────────────────────────────────────────────

  // A popover and not a script: the browser opens it from `popovertarget`,
  // closes it on Escape and on an outside click, and hands focus back.
  test('draws the range control as a native popover', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="events-range-button"]')
    const panel = $('[data-testid="events-range-panel"]')

    expect(button.is('button')).toBe(true)
    expect(button.attr('type')).toBe('button')
    expect(button.attr('popovertarget')).toBe('events-range-panel')
    expect(panel.attr('id')).toBe('events-range-panel')
    expect(panel.attr('popover')).toBeDefined()
    expect(panel.attr('class')).toContain('dropdown')
    // The anchor pair: the panel is positioned against the button by name.
    expect(button.attr('style')).toBe('anchor-name:--events-range')
    expect(panel.attr('style')).toBe('position-anchor:--events-range')
    expect($('do-dropdown')).toHaveLength(0)
    expect($('[data-testid="events-range"] details')).toHaveLength(0)
  })

  // `Time: Any` on the trigger; the rung in the panel keeps `Any time`.
  test('says Time: Any on the button of a page with no window', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="events-range-button"]')
    const any = $('[data-testid="events-range-any"]')

    expect(flatten(button.text())).toBe('Time: Any')
    expect(button.attr('title')).toBe('Time range: Any')
    expect(button.find('[data-testid="do-icon-clock"]')).toHaveLength(1)
    expect(button.find('[data-testid="do-icon-chevron-down"]')).toHaveLength(1)
    expect(flatten(any.text())).toBe('Any time')
    expect(any.attr('aria-current')).toBe('true')
    expect(
      any.find('[data-testid="do-icon-check"]').hasClass('invisible')
    ).toBe(false)
  })

  test('says the preset back on the page its link opens', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-15T10:19:57.000Z&range=24h'
    )

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'Time: Last 24h'
    )
    expect(
      $('[data-testid="events-range-preset"][data-value="24h"]').attr(
        'aria-current'
      )
    ).toBe('true')
  })

  test('says an absolute window as the pair of instants it is', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-09-01T00:00:00&to=2026-09-02T00:00:00'
    )

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'Time: 2026-09-01 00:00 → 2026-09-02 00:00'
    )
  })

  test('offers Any time as a rung, clearing the window and its label', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&from=2026-06-15T10:19:57.000Z&range=24h'
    )

    expect($('[data-testid="events-range-any"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER'
    )
  })

  test('carries the range label onto every filter link', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-15T10:19:57.000Z&range=24h'
    )

    expect(
      segmentFor($, 'events-status-tile', 'DEAD_LETTER').attr('href')
    ).toContain('range=24h')
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('href')
    ).toContain('range=24h')
  })

  test('says nothing about parking anywhere on the list', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-parked"]')).toHaveLength(0)
    expect(segments($, 'events-status-tile').join(' ')).not.toContain('Parked')
    expect($('main').text()).not.toContain('Parked')
    expect($('main').html()).not.toContain('PARKED')
  })
})
