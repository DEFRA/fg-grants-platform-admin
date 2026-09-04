import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  Event,
  EventBreakdownGroup,
  EventCounts,
  EventFacets,
  EventsPagination,
  SourceError
} from '../use-cases/get-events.use-case.ts'
import { getEventsUseCase } from '../use-cases/get-events.use-case.ts'

vi.mock(import('../use-cases/get-events.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

/** No base url configured is the default, and switches the links off. */
const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const event = (overrides: Partial<Event> = {}): Event => ({
  service: 'gas',
  box: 'outbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  source: null,
  target: 'gas__sns__update_case_status_fifo',
  segregationRef: 'GLD-9B2-BWS-grasslands',
  status: 'PUBLISHED',
  attempts: 1,
  maxAttempts: 5,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: null,
  completedAt: null,
  lastError: null,
  traceId,
  ...overrides
})

const pagination = (
  overrides: Partial<EventsPagination> = {}
): EventsPagination => ({
  startCursor: null,
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: false,
  ...overrides
})

/**
 * The dataset-wide breakdown, as the counts endpoint reports it: every status
 * always present, zero included. The two large figures are the shape of a real
 * deployment — most of the stream has completed, and the dead letters behind it
 * are the reason anyone opens this page.
 */
const counts = (overrides: Partial<EventCounts> = {}): EventCounts => ({
  PUBLISHED: 0,
  PROCESSING: 0,
  FAILED: 0,
  RESUBMITTED: 0,
  COMPLETED: 236196,
  DEAD_LETTER: 7064,
  ...overrides
})

/**
 * The whole of what the counts endpoint answers with: the status counts, and
 * nothing derived from them. Every figure on the page is one of these seven or
 * their sum.
 */
const facets = (overrides: Partial<EventCounts> = {}): EventFacets => ({
  counts: counts(overrides)
})

const givenEvents = (
  events: Event[] = [event()],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(overrides), sourceErrors },
    facets: facets(),
    breakdown: null,
    unavailable: false
  })

/**
 * The dead letters behind the filters, grouped by the failure that caused them
 * — as the breakdown endpoint reports them, count descending.
 */
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

/** A page with a breakdown behind it, and whatever counts it was asked for. */
const givenBreakdown = (
  groups: EventBreakdownGroup[] = [group()],
  countOverrides: Partial<EventCounts> = {},
  events: Event[] = [event({ status: 'DEAD_LETTER' })]
) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    facets: facets(countOverrides),
    breakdown: { groups, sourceErrors: [] },
    unavailable: false
  })

/** The same page with counts of its own. */
const givenCounts = (overrides: Partial<EventCounts>, events = [event()]) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    facets: facets(overrides),
    breakdown: null,
    unavailable: false
  })

/**
 * A page whose rows read perfectly well and whose counts did not. It is not an
 * outage — the segments simply go back to being the labels they were before
 * the counts endpoint existed, and nothing on the page mentions it.
 */
const givenNoCounts = (events: Event[] = [event()]) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(), sourceErrors: [] },
    facets: null,
    breakdown: null,
    unavailable: false
  })

const givenUnavailable = () =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events: [], pagination: pagination(), sourceErrors: [] },
    facets: null,
    breakdown: null,
    unavailable: true
  })

const xss = '<script>alert(1)</script>'

/**
 * A retry storm as the endpoint returns one: the same message, reference,
 * status and route, four minutes apart, one row per attempt. Only the id tells
 * the members apart, which is exactly why the page folds them.
 */
const storm = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    event({
      id: `storm-${index}`,
      eventId: `storm-${index}-1111-2222-3333`,
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
      createdAt: new Date(
        Date.parse('2026-06-16T06:48:00.000Z') - index * 4 * 60 * 1000
      ).toISOString(),
      lastFailureAt: '2026-06-16T06:48:00.000Z'
    })
  )

/**
 * A row that failed with a reason, as the endpoint now reports one: the error
 * class, its one-line message and when it happened.
 */
const failing = (message: string, name = 'MongoServerError') =>
  event({
    status: 'FAILED',
    attempts: 5,
    maxAttempts: 5,
    lastFailureAt: '2026-06-16T10:16:05.000Z',
    lastError: { name, message, at: '2026-06-16T10:16:05.000Z' }
  })

/**
 * Every cell on this page carries a string the endpoint passed through from a
 * Mongo document, so each is checked to arrive as text rather than as markup.
 * The layout carries one module script of its own (layouts/page.njk), which is
 * why this looks inside the cell rather than at the document.
 *
 * Facts rather than assertions, so each test still owns its own `expect`.
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

/**
 * The class an ordinary line of the table wears: the hover tint, which is the
 * whole of a healthy row's state. A dead letter wears the error wash instead.
 */
const rowClass = 'hover:bg-base-200'
const deadLetterRowClass = 'bg-error/5 hover:bg-error/10'

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

/** The failure a page narrowed by `?error=` is narrowed to, and that page. */
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

  test('forwards the cursor, direction, status and service', async () => {
    await viewPage(
      '/dev-ops/events?cursor=END&direction=forward&status=FAILED&service=gas'
    )

    expect(getEventsUseCase).toHaveBeenCalledWith({
      cursor: 'END',
      direction: 'forward',
      status: 'FAILED',
      service: 'gas'
    })
  })

  // A value outside the vocabulary this app offers is refused here rather than
  // forwarded. It used to go through to fg-gas-backend, come back 400, and be
  // drawn as "Events could not be loaded from GAS" — a typo reported as an
  // outage, on the page operators open to find out whether there is one.
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
    ['/dev-ops/events?service=caseworking', { service: 'caseworking' }],
    ['/dev-ops/events?direction=backward', { direction: 'backward' }]
  ])('forwards %s, which it does hold', async (url, expected) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith(expected)
  })

  // Neither filter has a control that can be cleared — both are links, and a
  // link either carries the filter or does not — so an empty one is a url
  // nobody issued, exactly as it was before the values were checked.
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

  // The TYPE filter is gone. `kind` is not a parameter this page takes any
  // more, so a stale bookmarked url is refused the way any unknown parameter
  // has always been rather than being quietly ignored — and nothing about it
  // reaches the endpoint, which would 400 on it too.
  test('refuses a kind rather than forwarding it', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?kind=audit')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  // The box is typed into, so what reaches the endpoint is whatever a hurried
  // paste left around the value.
  test('trims the search before forwarding it', async () => {
    await viewPage('/dev-ops/events?q=%20%20gld-9b2%20')

    expect(getEventsUseCase).toHaveBeenCalledWith({ q: 'gld-9b2' })
  })

  // Clearing the box with the keyboard and pressing enter submits `q=`, and
  // the endpoint answers 400 for an empty needle. An empty search is no
  // search: the operator gets the unfiltered page they asked for, not an
  // error alert about a query they did not knowingly make.
  test('treats an empty search as no search at all', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?q=&status=FAILED')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ status: 'FAILED' })
  })

  // The alert is for a backend that is actually unwell, which is now the only
  // way to reach it: a query this app knows how to spell, refused by GAS.
  test('shows the error alert when the endpoint refuses a query it accepts', async () => {
    givenUnavailable()

    const { statusCode, $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="events-error"]')).toHaveLength(1)
    expect($('.govuk-heading-xl')).toHaveLength(0)
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

  // The filter bar shows the state of the page, so the subtitle no longer
  // narrates it: it says what the page is, once, whatever is selected.
  test('says what the page is, and leaves the filter to the chips', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-subtitle"]').text().trim()).toBe(
      'Inbox and outbox messages across GAS, Caseworking and connected services.'
    )
    expect($('main').text()).not.toContain('No filter applied')
    expect($('main').text()).not.toContain('Filtered:')
  })

  // Sentence case throughout the toolbar: nothing in it shouts, labels
  // included, and the badges below say the same words the same way. The STATUS
  // segments carry the count that says whether one is worth opening — the whole
  // reason the strip that used to say it separately is gone.
  test('counts every status segment but All, and no service segment', async () => {
    const { $ } = await viewPage()

    // A zero says nothing the dimmed segment beside it has not said already,
    // and seven of them made the one figure worth reading compete for
    // attention. The count on an empty segment lives on its title.
    expect(segments($, 'events-filter-status-chip')).toEqual([
      'All',
      'Published',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'Caseworking'
    ])
    expect($('[data-testid="events-filter-service-chip-count"]')).toHaveLength(
      0
    )
  })

  // `All` is the sum of the segments beside it, so the status row adds up to
  // itself however the page is filtered. It can be, because the counts
  // endpoint refuses `status` outright — which is exactly what makes those
  // counts the status facet rather than a count of what is already selected.
  test('keeps every status counted on a page filtered to one of them', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect(segments($, 'events-filter-status-chip')).toEqual([
      'All',
      'Published',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed 236,196',
      'Dead letter 7,064'
    ])
  })

  test('marks the selected service without numbering any of them', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'Caseworking'
    ])
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('aria-current')
    ).toBe('page')
  })

  // The figure is the thing being read, so it is a badge inside the button —
  // daisyUI's own "badge in a button" — and the word beside it stays a word.
  // Tabular, because the segments are read down as much as along.
  test('sets the figure on a segment as a quiet badge', async () => {
    const { $ } = await viewPage()

    expect(
      segmentFor($, 'events-filter-status-chip', 'COMPLETED')
        .find('[data-testid="events-filter-status-chip-count"]')
        .attr('class')
    ).toBe('badge badge-ghost badge-sm tabular-nums')
  })

  // A segment that vanished when it emptied could not be told from one the
  // page had forgotten to draw, and `Failed 0` is the most reassuring thing on
  // this page. It stays, dimmed, and it stays a link.
  test('dims an empty segment and still links it', async () => {
    const { $ } = await viewPage()

    const failed = segmentFor($, 'events-filter-status-chip', 'FAILED')

    expect(flatten(failed.text())).toBe('Failed')
    expect(
      failed.find('[data-testid="events-filter-status-chip-count"]')
    ).toHaveLength(0)
    // The figure it does not draw is still one hover away.
    expect(failed.attr('title')).toBe('Awaiting automatic retry · 0 events')
    expect(failed.attr('class')).toContain('text-base-content/60')
    expect(failed.attr('href')).toBe('/dev-ops/events?status=FAILED')
    expect(
      segmentFor($, 'events-filter-status-chip', 'DEAD_LETTER').attr('class')
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

  // The dead letters are the page's subject and the one figure in the toolbar
  // allowed a colour at all — until there are none, which is not an alarm.
  test('colours the dead letter count, and only while there is one', async () => {
    const { $ } = await viewPage()

    expect(
      segmentFor($, 'events-filter-status-chip', 'DEAD_LETTER')
        .find('[data-testid="events-filter-status-chip-count"]')
        .attr('class')
    ).toBe('badge badge-error badge-sm tabular-nums')

    givenCounts({ DEAD_LETTER: 0 })

    const { $: quiet } = await viewPage()

    // No dead letters is no badge at all, not a red nought: an alarm about
    // nothing is the one figure on this toolbar that must never cry wolf.
    expect(quiet('main').html()).not.toContain('badge-error')
    expect(
      segmentFor(quiet, 'events-filter-status-chip', 'DEAD_LETTER').attr(
        'title'
      )
    ).toContain('0 events')
  })

  // A summary that could not be read has not made the filters below it an
  // error, and there is nothing here worth an alert: the segments go back to
  // being the words they always were.
  test('renders every segment as a label alone when the counts fail', async () => {
    givenNoCounts()

    const { $ } = await viewPage()

    expect(segments($, 'events-filter-status-chip')).toEqual([
      'All',
      'Published',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed',
      'Dead letter'
    ])
    expect(segments($, 'events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'Caseworking'
    ])
    expect($('[data-testid="events-filter-kind-chip"]')).toHaveLength(0)
    expect($('[data-testid="events-filter-status-chip-count"]')).toHaveLength(0)
    expect($('[data-testid="events-error"]')).toHaveLength(0)
    expect($('[data-testid="events-partial"]')).toHaveLength(0)
  })

  // Six states named in one word each is a vocabulary an operator is expected
  // to already have, and the pairs that matter are the ones the words do not
  // distinguish.
  test('explains what each status segment is counting', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="events-filter-status-chip"]')
        .toArray()
        .map((chip) => $(chip).attr('title'))
    ).toEqual([
      undefined,
      'Queued, not yet claimed · 0 events',
      'Claimed, in flight · 0 events',
      'Awaiting automatic retry · 0 events',
      'Queued for another retry cycle · 0 events',
      'Processed successfully',
      'Failed all retry attempts; needs a redrive'
    ])
  })

  test('renders each filter group as a join of small buttons', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filter-status"]').hasClass('join')).toBe(
      true
    )
    expect($('[data-testid="events-filter-service"]').hasClass('join')).toBe(
      true
    )
    expect(
      $('[data-testid="events-filter-status-chip"]').first().attr('class')
    ).toContain('btn btn-sm join-item')
  })

  // A strip stretched to the width of the page drew a border around nine
  // buttons and 700px of nothing. The toolbar shrink-wraps what it holds now,
  // and carries no border of its own: each group is outlined already.
  test('gives the toolbar no border or surface of its own', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-filters"]')

    expect(toolbar).toHaveLength(1)
    expect(toolbar.attr('class')).toContain('items-center')
    expect(toolbar.attr('class')).not.toContain('border')
    expect(toolbar.attr('class')).not.toContain('bg-base-100')
    expect(toolbar.find('[data-testid="events-filter-status"]')).toHaveLength(1)
    expect(toolbar.find('[data-testid="events-filter-service"]')).toHaveLength(
      1
    )
    expect($('[data-testid="events-filter-label"]').first().text()).toBe(
      'Status'
    )
  })

  // Which controls shared a line used to depend on how wide the count badges
  // happened to render, so the toolbar re-laid itself out as the figures
  // changed. The two rows are declared: what the page is filtered to on the
  // first, how it is narrowed and searched on the second.
  test('lays the toolbar out as two declared rows', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-toolbar"]')
    const rows = toolbar.children()

    expect(toolbar.attr('class')).toContain('grid')
    expect(rows.toArray().map((row) => $(row).attr('data-testid'))).toEqual([
      'events-filters',
      'events-controls'
    ])
    expect(
      rows.first().find('[data-testid="events-filter-status"]')
    ).toHaveLength(1)
    expect(
      rows.first().find('[data-testid="events-filter-service"]')
    ).toHaveLength(1)
    expect(rows.last().find('[data-testid="events-range"]')).toHaveLength(1)
    expect(rows.last().find('[data-testid="events-search"]')).toHaveLength(1)
    // Hard right, so the gap between the two clusters is a gap and not a
    // ragged field of nothing.
    expect(rows.last().attr('class')).toContain('justify-end')
  })

  // A segmented control is one outline around a run of segments. Each group
  // draws its own, so the rule that used to stand between them has nothing
  // left to separate.
  test('outlines each filter group once, as a segmented control', async () => {
    const { $ } = await viewPage()

    const groups = [
      $('[data-testid="events-filter-status"]'),
      $('[data-testid="events-filter-service"]')
    ]

    groups.forEach((group) => {
      // The join draws the outline; the app adds nothing of its own to it.
      expect(group.attr('class')).toBe('join')
      expect(group.attr('role')).toBe('group')
      expect(group.attr('aria-label')).toContain('Filter by')
    })
    expect($('[data-testid="events-filter-divider"]')).toHaveLength(0)
  })

  // The labels name the groups; the chips are the options. Small and muted is
  // what tells the eye which of the two it is looking at — set as prose,
  // `Status` read as a chip nobody could click. Sentence case, not capitals:
  // a working interface does not shout its own furniture.
  test('sets the toolbar labels apart from the chips they introduce', async () => {
    const { $ } = await viewPage()

    const labels = $('[data-testid="events-filter-label"]')
      .toArray()
      .map((label) => $(label))

    expect(labels.map((label) => label.text().trim())).toEqual([
      'Status',
      'Service',
      'Time'
    ])
    labels.forEach((label) => {
      expect(label.attr('class')).toBe(
        'text-xs font-medium text-base-content/60'
      )
      expect(label.attr('class')).not.toContain('uppercase')
    })
  })

  // A label and the segments it introduces are one object. Spaced alike in a
  // single row, there was as much air between `Status` and its own control as
  // between the two controls, and the toolbar read as more things than it is.
  test('keeps each label with its own group, and the groups apart', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filters"]').attr('class')).toContain(
      'gap-x-5'
    )

    const pairs = $(
      '[data-testid="events-filters"] > div, [data-testid="events-controls"] > div'
    )

    expect(pairs).toHaveLength(3)
    pairs.toArray().forEach((pair) => {
      expect($(pair).attr('class')).toContain('gap-2')
      expect($(pair).find('[data-testid="events-filter-label"]')).toHaveLength(
        1
      )
    })
    expect(
      pairs.first().find('[data-testid="events-filter-status"]')
    ).toHaveLength(1)
    expect(
      pairs.eq(1).find('[data-testid="events-filter-service"]')
    ).toHaveLength(1)
    // The time range opens the second row: a label, and one control beside it.
    expect(pairs.last().attr('data-testid')).toBe('events-range')
    expect(
      pairs.last().find('[data-testid="events-range-button"]')
    ).toHaveLength(1)
    expect($('[data-testid="events-filter-kind"]')).toHaveLength(0)
  })

  // The count belongs with the other numbers about this page, not with the
  // controls that chose it.
  test('counts nothing in the toolbar at all', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filters"]').text()).not.toContain('event')
    expect(
      $('[data-testid="events-filters"] [data-testid="events-count"]')
    ).toHaveLength(0)
  })

  // Marked by daisyUI's own word for it. `btn-active` is the state a segmented
  // control is meant to wear, and the app no longer paints a tint of its own
  // over a ghost button to say the same thing.
  test('marks the segment the page is filtered to', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const active = $('[data-testid="events-filter-status-chip"][aria-current]')

    expect(active.attr('class')).toBe('btn btn-sm join-item btn-active')
    expect(active.attr('class')).not.toContain('btn-neutral')
    expect(flatten(active.text())).toBe('Dead letter 7,064')

    const inactive = $('[data-testid="events-filter-status-chip"]').first()

    expect(inactive.attr('class')).toBe('btn btn-sm join-item font-normal')
  })

  // A border on a segment inside a bordered group is a second outline saying
  // the same thing, and it doubles up on every seam.
  test('gives no segment a border of its own', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const segments = $(
      '[data-testid="events-filter-status-chip"], [data-testid="events-filter-service-chip"]'
    )

    expect(segments.length).toBeGreaterThan(0)
    segments.toArray().forEach((segment) => {
      expect($(segment).attr('class')).not.toContain('border')
    })
  })

  test('fills All on a page opened with no filter', async () => {
    const { $ } = await viewPage()

    const active = $('[aria-current="page"]')
      .toArray()
      .map((chip) => flatten($(chip).text()))

    expect(active).toEqual(['All', 'All'])
  })

  // Every chip is a link the server rendered: the page carries no script that
  // could build one.
  test('renders every chip as a link that keeps the other filter', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    expect(
      segmentFor($, 'events-filter-status-chip', 'FAILED').attr('href')
    ).toBe('/dev-ops/events?status=FAILED&service=gas')
    expect(
      $('[data-testid="events-filter-status-chip"]').first().attr('href')
    ).toBe('/dev-ops/events?service=gas')
  })

  test('drops the cursor from every filter link, restarting the paging', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?cursor=END&direction=forward&status=FAILED'
    )

    const hrefs = $('[data-testid="events-filters"] a')
      .toArray()
      .map((chip) => $(chip).attr('href') ?? '')

    expect(hrefs).not.toHaveLength(0)
    expect(hrefs.some((href) => href.includes('cursor'))).toBe(false)
    expect(hrefs.some((href) => href.includes('direction'))).toBe(false)
  })

  test('keeps the filter bar on a page whose filter found nothing', async () => {
    givenEvents([])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-empty"]')).toHaveLength(1)
    expect($('[data-testid="events-filter-status-chip"]')).toHaveLength(7)
  })

  test('keeps the filter bar when nothing could be read at all', async () => {
    givenUnavailable()

    const { $ } = await viewPage()

    expect($('[data-testid="events-filters"]')).toHaveLength(1)
  })

  test('sits the filter bar between the heading and the table', async () => {
    const { $ } = await viewPage()

    const order = $('main [data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        ['events-heading', 'events-filters', 'events-card'].includes(id ?? '')
      )

    expect(order).toEqual(['events-heading', 'events-filters', 'events-card'])
  })

  // The TYPE control is gone with the filter it drove: two axes on the
  // toolbar, not three, and no `kind` on any link the page draws.
  test('draws no TYPE control at all', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filter-kind"]')).toHaveLength(0)
    expect($('[data-testid="events-filter-kind-chip"]')).toHaveLength(0)
    expect(segments($, 'events-filter-label')).toEqual([
      'Status',
      'Service',
      'Time'
    ])
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

  // Every other filter keeps the search on its href, or narrowing by status
  // while holding a reference would drop the reference.
  test('keeps the search on the status and service segments', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const hrefs = $('[data-testid="events-filters"] a')
      .toArray()
      .map((chip) => $(chip).attr('href') ?? '')

    expect(hrefs).not.toHaveLength(0)
    expect(hrefs.every((href) => href.includes('q=gld-9b2'))).toBe(true)
  })

  // The one control on the page that takes a value the server cannot
  // enumerate, and the shortest path an operator has: they arrive holding an
  // id from a log line or a reference from a case.
  test('offers a search box in the toolbar, holding the current search', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const form = $('[data-testid="events-search"]')
    const input = $('[data-testid="events-search-input"]')

    expect(form.closest('[data-testid="events-controls"]')).toHaveLength(1)
    expect(form.attr('method')).toBe('get')
    expect(form.attr('action')).toBe('/dev-ops/events')
    expect(input.attr('type')).toBe('search')
    expect(input.attr('name')).toBe('q')
    expect(input.attr('value')).toBe('gld-9b2')
    expect(input.attr('placeholder')).toBe('Event id, message id or reference…')
    // The box and its button are one `join`, and the box itself is the
    // daisyUI `input` label that holds the search glyph beside the field.
    expect(form.attr('class')).toBe('join')
    expect($('[data-testid="events-search-label"]').attr('class')).toBe(
      'input input-sm join-item w-80'
    )
    expect(
      $('[data-testid="events-search-label"] [data-testid="do-icon-search"]')
    ).toHaveLength(1)
    expect(input.closest('[data-testid="events-search-label"]')).toHaveLength(1)
    expect($('[data-testid="events-search-submit"]').attr('type')).toBe(
      'submit'
    )
    expect($('[data-testid="events-search-submit"]').attr('class')).toBe(
      'btn btn-sm join-item'
    )
  })

  test('opens the search box empty on a page that is not a search', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-search-input"]').attr('value')).toBe('')
  })

  // A form submits its own fields and nothing else: without the hidden ones,
  // searching from a page filtered to Dead letter would quietly widen it to
  // every status. The cursor is not among them — a keyset position taken over
  // the whole stream means nothing over a search of it.
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

  // Real table headers now, dressed by daisyUI's own `table` rather than by a
  // heading class this app spelled four times. Sentence case, not capitals.
  test('heads the table with real th cells, in sentence case', async () => {
    const { $ } = await viewPage()

    const heading = headings($).eq(0)

    expect(heading.is('th')).toBe(true)
    expect(heading.text().trim()).toBe('Event')
    expect($('[data-testid="events-table"] thead')).toHaveLength(1)
  })

  // An auto table measures its own contents, so a page of 24-hex Mongo ids
  // gave Event a different width from a page of uuids and paging read as the
  // table being rebuilt. Every share is declared on its header, once.
  test('fixes the column widths in proportion, on the headers', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toContain(
      'table-fixed'
    )
    expect(
      headings($)
        .toArray()
        .map((cell) => classOf($(cell)).replace(' text-right', ''))
    ).toEqual(['w-[46%]', 'w-[19%]', 'w-[21%]', 'w-[14%]'])
  })

  // The four percent the selection gutter held went to Event and Source, the
  // two columns with something to say. The proportions do not move with the
  // filter: a table that re-laid itself out when an operator selected Dead
  // letter is a table being rebuilt exactly when they are working fastest.
  test('holds the same proportions whatever the page is filtered to', async () => {
    const { $: healthy } = await viewPage()

    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $: dead } = await viewPage('/dev-ops/events?status=DEAD_LETTER')
    const widths = ($: CheerioAPI) =>
      headings($)
        .toArray()
        .map((cell) => classOf($(cell)))

    expect(widths(healthy)).toEqual(widths(dead))
    expect(dead('[data-testid="event-row"] > td')).toHaveLength(4)
  })

  // A fixed column cannot grow to fit, so everything that could outrun one is
  // cut by the column and kept whole on its title.
  test('cuts what outruns a fixed column, and keeps it on the title', async () => {
    givenEvents([failing('connect ETIMEDOUT 10.0.3.14:443')])

    const { $ } = await viewPage()

    for (const testId of [
      'event-id',
      'event-type',
      'event-hop',
      'event-queue',
      'event-error'
    ]) {
      const cell = $(`[data-testid="${testId}"]`)

      expect(classOf(cell)).toContain('truncate')
      expect(cell.attr('title')).not.toBe('')
      expect(cell.attr('title')).toBeDefined()
    }
  })

  // Figures are read against their own right edge, so the one column of them
  // is right-aligned in the header as well as in the body.
  test('right-aligns the column of figures, header and cells', async () => {
    givenEvents([event({ lastFailureAt: '2026-06-16T10:16:05.000Z' })])

    const { $ } = await viewPage()

    const heads = headings($)

    expect(heads.eq(3).attr('class')).toContain('text-right')
    expect(classOf(heads.eq(0))).not.toContain('text-right')
    expect(classOf(heads.eq(1))).not.toContain('text-right')
    expect(classOf(heads.eq(2))).not.toContain('text-right')

    const cells = $('[data-testid="event-row"]').first().find('td')

    expect(cells.eq(3).attr('class')).toContain('text-right')
    expect(classOf(cells.eq(0))).not.toContain('text-right')
    expect(classOf(cells.eq(1))).not.toContain('text-right')
    expect(classOf(cells.eq(2))).not.toContain('text-right')
  })

  test('sets every figure in tabular monospace', async () => {
    givenEvents([
      event({ attempts: 5, lastFailureAt: '2026-06-16T10:16:05.000Z' })
    ])

    const { $ } = await viewPage()

    const figures = [
      $('[data-testid="event-created-at"]'),
      $('[data-testid="event-failure"]')
    ]

    figures.forEach((figure) => {
      expect(figure.attr('class')).toContain('font-mono')
      expect(figure.attr('class')).toContain('tabular-nums')
    })
  })

  // Four columns. Failure was a fifth, and on a healthy page it was a ruled
  // column of dashes: a count and a time are facts about a row's *status*, so
  // they hang under the status instead, and the width the column gave up went
  // to Event and Queue.
  //
  // `Queue` is the one word all three surfaces use for this: the column here,
  // the fact on an event's own page, and the journey table's first column. The
  // cell still says which hop the row is — which service and which box — with
  // where the message came from or went to under it.
  test('heads the table with its four columns in order', async () => {
    const { $ } = await viewPage()

    expect(
      headings($)
        .toArray()
        .map((cell) => $(cell).text().trim())
    ).toEqual(['Event', 'Status', 'Queue', 'Created'])
  })

  test('adds no further column for actions, counts, failures or a source chip', async () => {
    const { $ } = await viewPage()

    expect(headings($)).toHaveLength(4)
    expect($('[data-testid="event-row"]').first().find('> td')).toHaveLength(4)
  })

  // The id is the first thing in every row now. The gutter that held a
  // checkbox went with the batch redrive it fed, and the disclosure caret went
  // with the groups before it: the table draws no mark of its own at all.
  test('starts every row at the id, with no gutter and no caret', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    const firsts = $('[data-testid="event-row"]')
      .toArray()
      .map((row) => $(row).find('> td').first())

    expect(firsts).toHaveLength(4)
    firsts.forEach((cell) => {
      expect(cell.find('[data-testid="event-id"]')).toHaveLength(1)
    })
    expect($('[data-testid="events-table"] .do-caret')).toHaveLength(0)
    expect($('[data-testid="events-table"] input')).toHaveLength(0)
    expect(headings($).first().text().trim()).toBe('Event')
  })

  // A real `<table>`. The grid existed to let runs of identical rows fold into
  // a `<details>` group, which no `<tbody>` will hold; grouping is gone, so
  // the semantics come free instead of being bolted back on with roles.
  test('builds the table as a real table, with no roles bolted on', async () => {
    const { $ } = await viewPage()

    const table = $('[data-testid="events-table"]')

    expect(table.is('table')).toBe(true)
    expect(table.attr('class')).toContain('table table-sm')
    expect(table.attr('role')).toBeUndefined()
    expect($('[data-testid="events-head"]').is('tr')).toBe(true)
    expect($('[data-testid="events-head"]').closest('thead')).toHaveLength(1)
    expect($('[data-testid="event-row"]').first().is('tr')).toBe(true)
    expect(
      $('[data-testid="event-row"]').first().closest('tbody')
    ).toHaveLength(1)
    expect($('[data-testid="events-table"] [role="cell"]')).toHaveLength(0)
  })

  // Twenty rows of ids all look alike, and a column of figures whose heading
  // has scrolled away is a column of unlabelled numbers. daisyUI pins it.
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

  // The strip is gone. It was a second control saying the same seven status
  // words the toolbar already said, under a heading explaining that its
  // figures were about something else than the figures beside them; the counts
  // are on the segments now and the card starts with the table's own content.
  test('draws no rollup strip at all', async () => {
    givenEvents(storm(20))

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup"]')).toHaveLength(0)
    expect($('[data-testid="events-count-chip"]')).toHaveLength(0)
    expect($('[data-testid="events-counts-label"]')).toHaveLength(0)
    expect($('[data-testid="events-rollup-bucket"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Across current filters')
  })

  // The page-derived buckets went with it. They were the fallback for a failed
  // counts read, and the answer to that now is a toolbar of plain labels —
  // page-shaped arithmetic dressed as a statement about the stream is exactly
  // what this page has spent its redesign getting rid of.
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

  // How the rows are *drawn* is not one of the page's facts: it is a rendering
  // decision the carets in the gutter already show, and it changed as an
  // operator filtered, which read as the stream having changed.
  test('says nothing about how many groups the rows fold into', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-groups"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('1 group')
  })

  // Where one keyset window happens to end is not a fact about the stream, and
  // it moved every time an operator paged. The rows are in time order and the
  // last one on the page says it better than a sentence above them.
  test('says nothing about the age of the oldest row on the page', async () => {
    givenEvents([
      event({ id: '1', createdAt: '2026-06-16T10:00:00.000Z' }),
      event({ id: '2', createdAt: '2026-06-16T06:33:00.000Z', type: 'other' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-oldest"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('oldest')
  })

  // Three filters arrive with no segment to sit in: a search that is only a
  // string inside a box, a failure that arrives by being clicked, and a window
  // that disappears into two inputs the moment it is submitted. Each is a
  // filter an operator forgets is on, so each is said in words under the
  // toolbar with the way out of it beside it.
  test('says what the page is a search of, with a way out of it', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED&q=gld-9b2')

    const note = $('[data-testid="events-note-search"]')
    const clear = $('[data-testid="events-note-search-clear"]')

    expect(flatten(note.text())).toBe('Matching "gld-9b2"')
    expect(note.closest('[data-testid="events-filter-notes"]')).toHaveLength(1)
    expect(clear.text().trim()).toBe('Clear ×')
    expect(clear.attr('href')).toBe('/dev-ops/events?status=FAILED')
  })

  // Under the toolbar and above the card: the notes are filter state, and that
  // is where the filters are.
  test('sits the notes between the toolbar and the card', async () => {
    const { $ } = await viewPage('/dev-ops/events?q=gld-9b2')

    const order = $('main [data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        ['events-filters', 'events-filter-notes', 'events-card'].includes(
          id ?? ''
        )
      )

    expect(order).toEqual([
      'events-filters',
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

  // Nothing dangles at either end: the separators sit between the notes, so
  // one note on its own is one note and not a note and a middot.
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

  // Over the table, not on a filter: it is the one number that answers to
  // every filter at once, and it used to sit inside the STATUS All segment
  // where selecting a status left it unmoved.
  test('states the total over the table, and on no segment', async () => {
    const { $ } = await viewPage()

    const total = $('[data-testid="events-total"]')

    expect(flatten(total.text())).toBe('243,260 events')
    expect(total.closest('[data-testid="events-card"]')).toHaveLength(1)
    expect(total.closest('[data-testid="events-filters"]')).toHaveLength(0)
    expect(total.attr('title')).toBe(
      'Events matching every filter on this page'
    )
  })

  test('moves the total when the status filter moves', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect(flatten($('[data-testid="events-total"]').text())).toBe(
      '7,064 events'
    )
    // ...while the segments stay a facet and keep their own figures.
    expect(
      segmentFor($, 'events-filter-status-chip', 'COMPLETED').text()
    ).toContain('236,196')
  })

  test('draws no total at all when the counts could not be read', async () => {
    givenNoCounts()

    const { $ } = await viewPage()

    expect($('[data-testid="events-total"]')).toHaveLength(0)
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

  // The type leads the cell now: it is what an operator scans for, and the id
  // is what they check once they have found the row.
  //
  // Mono, because it is a machine string — `case.status.updated` is grepped
  // and pasted, not read as prose — and the id and the topic beside it are
  // The type is the row's first word, and a first word has to read at a
  // glance. Mono made it the same texture as the id beside it and the cell had
  // no anchor at all; sans and weight give it one, and the dots in the name
  // still say it is a symbol without the column having to be typewritten.
  // The id leads, because it is the one identifier every row has: an audit
  // record publishes no CloudEvent type, and a column headed by the type had to
  // invent a placeholder for it.
  test('leads the identity cell with the id, in semibold mono', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.text()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(id.attr('class')).toContain('text-sm')
    expect(id.attr('class')).toContain('font-semibold')
  })

  test('sets the type under the id, smaller and quieter', async () => {
    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect(type.text()).toBe('case.status.updated')
    expect(type.attr('class')).toContain('text-xs')
    expect(type.attr('class')).not.toContain('font-semibold')
  })

  // The id is the machine half of the cell and the only part of the row set
  // that way; the type beneath it is prose.
  test('keeps the id in mono and the type beneath it in sans', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-id"]').attr('class')).toContain('font-mono')
    expect($('[data-testid="event-type"]').attr('class')).not.toContain(
      'font-mono'
    )
  })

  // The hop is the line a human reads, so it stays in the page's own face at
  // the size the row's other words are set in; the queue under it is the
  // quieter, smaller half of the cell.
  test('keeps the hop label above the queue, quieter', async () => {
    const { $ } = await viewPage()

    const hop = $('[data-testid="event-hop"]')
    const queue = $('[data-testid="event-queue"]')

    expect(hop.attr('class')).toBe('link link-hover block truncate')
    expect(queue.attr('class')).toContain('text-xs')
    expect(queue.attr('class')).toContain('text-base-content/50')
  })

  // Neither value is cut before the column has to: the whole target is on the
  // title either way, and the cell is a real `td` that the table sizes.
  test('leaves the cut to the column, on both of its lines', async () => {
    const { $ } = await viewPage()

    const hop = $('[data-testid="event-hop"]')
    const queue = $('[data-testid="event-queue"]')

    expect(hop.attr('title')).toBeDefined()
    expect(queue.attr('title')).toBe('gas__sns__update_case_status_fifo')
    expect(hop.text()).not.toContain('…')
  })

  // The whole id, unshortened: the string an operator copies should never
  // need a hover to read, and either spelling — a ~36-character CloudEvent
  // uuid or a 24-hex Mongo fallback — fits the Event track.
  test('shows the whole event id, unshortened', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.text()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(id.text()).not.toContain('…')
  })

  // The reference is off the table: it is on the row's own page, and the
  // search box still takes one. The id is the whole of the first line.
  test('shows no segregation reference anywhere in the table', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]').text()).not.toContain(
      'GLD-9B2-BWS-grasslands'
    )
  })

  // Two lines: the id on the first, the type on the second.
  test('sets the identity cell as the id line with the type beneath it', async () => {
    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] > td').eq(0)

    expect(cell.find('> a').attr('data-testid')).toBe('event-id')
    expect(cell.find('> div')).toHaveLength(1)
    expect(cell.find('> div').attr('data-testid')).toBe('event-type')
    expect(flatten(cell.text())).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666 case.status.updated'
    )
  })

  // The whole point of promoting the id: a row with no type is still fully
  // named, and nothing has to stand in for the missing half.
  test('draws no type line at all on a row that stores none', async () => {
    givenEvents([event({ type: null, fullType: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-type"]')).toHaveLength(0)
    expect($('[data-testid="event-id"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
    expect($('[data-testid="event-row"]').text()).not.toContain('n/a')
  })

  test('omits the segregation reference line when the row carries none', async () => {
    givenEvents([event({ segregationRef: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  // The id is a link now, and it points at one thing: every event carrying it.
  // It is still drawn as the token it is — no primary colour, no permanent
  // underline — because forty coloured links down a page would be forty
  // invitations where the page has one thing worth pointing at.
  // The id opens the row's own page — navigation, not a search. Mongo's unique
  // constraint means an id belongs to exactly one row, so the old
  // `?q=<id>` link could only ever answer with the row already on screen, and
  // its 'Show every event with this id' promise was never true.
  test('links the event id at its own page, and never at a search', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const id = $('[data-testid="event-id"]')

    expect(id.is('a')).toBe(true)
    expect(id.attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b?from=' +
        encodeURIComponent('?status=DEAD_LETTER')
    )
    expect(id.attr('href')).not.toContain('?q=')
    expect(id.attr('title')).toBe('3f2c1a0e-1111-2222-3333-444455556666')
  })

  test('says nothing about searching by id anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($.html()).not.toContain('Show every event with this id')
  })

  // A reference the row does not carry is not a link to nowhere.
  test('links nothing when the row carries no reference', async () => {
    givenEvents([event({ segregationRef: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  // The list carries no copy buttons at all now. Each one was a hover target
  // on every line of a page read by scanning, bought for a gesture an operator
  // can make one line later: every value that had one — the id, the queue name
  // and the created instant — is on a title here and drawn whole, with a copy
  // button of its own, on the row's own page. The detail page keeps its five.
  test('offers no copy button anywhere in the table', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-row"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
    expect(
      $('[data-testid="events-table"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
  })

  // The raw target is what an AWS console takes, and the line above it shows a
  // destination name instead — so the value has to stay reachable. It is on
  // the title, which is the whole of the affordance now.
  test('keeps the raw queue value on the title, with nothing to click', async () => {
    const { $ } = await viewPage()

    const queue = $('[data-testid="event-queue"]')

    expect(queue.text()).toBe('to Caseworking')
    expect(queue.attr('title')).toBe('gas__sns__update_case_status_fifo')
    expect(queue.next('[data-testid="do-copy-button"]')).toHaveLength(0)
  })

  test('shows how long ago the row was created', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-created-at"]').text().trim()).toBe('20m ago')
  })

  test('carries the absolute time in the title of the relative one', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-created-at"]').attr('title')).toBe(
      '2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)'
    )
  })

  // The dotted underline and the help cursor promised an interaction the page
  // does not have. The title is the whole of it.
  test('underlines no timestamp and marks none of them as hoverable', async () => {
    givenEvents([event({ lastFailureAt: '2026-06-16T10:16:05.000Z' })])

    const { $ } = await viewPage()

    const classes = [
      $('[data-testid="event-created-at"]').attr('class'),
      $('[data-testid="event-last-failure"]').attr('class')
    ]

    expect(classes.some((value) => value?.includes('do-timestamp'))).toBe(false)
    expect($('main').html()).not.toContain('do-timestamp')
  })

  // A row that failed once and recovered is not a problem, so the line that
  // says so is not red. The only colour a page carries is the dot on the
  // status and the wash on a dead letter.
  test('sets a last failure in plain muted text, with both formats on its title', async () => {
    givenEvents([event({ lastFailureAt: '2026-06-16T10:16:05.000Z' })])

    const { $ } = await viewPage()

    const failure = $('[data-testid="event-failure"]')

    expect($('[data-testid="event-last-failure"]').text().trim()).toBe('4m ago')
    expect(failure.attr('class')).toContain('text-base-content/50')
    expect(failure.attr('class')).not.toContain('text-error')
    expect(failure.attr('title')).toContain(
      '2026-06-16T10:16:05Z   ·   16 Jun 2026, 11:16:05 BST (Europe/London)'
    )
  })

  test('carries no red at all on a page with nothing wrong on it', async () => {
    givenEvents([
      event({ status: 'COMPLETED', lastFailureAt: '2026-06-16T10:16:05.000Z' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').html()).not.toContain('text-error')
    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
  })

  // One red per row, and the status dot is it. An exhausted attempts count
  // beside a red status was the same alarm twice on one line, and on a page of
  // dead letters it doubled every row's red.
  test('leaves colour to the status dot, even where the attempts are exhausted', async () => {
    givenEvents([
      event({
        status: 'DEAD_LETTER',
        attempts: 5,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

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

  // One row treatment, for one status. A dead letter is washed faintly in the
  // error colour; every other row is followed across the table by hovering it
  // and by nothing else.
  test('washes a dead letter row, and leaves every other row plain', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' }), event({ status: 'FAILED' })])

    const { $ } = await viewPage()

    const classes = $('[data-testid="event-row"]')
      .toArray()
      .map((row) => $(row).attr('class'))

    expect(classes).toEqual([deadLetterRowClass, rowClass])
  })

  test('leaves the summary of a healthy group unwashed', async () => {
    givenEvents([
      event({ id: 'a', eventId: 'a', status: 'COMPLETED' }),
      event({ id: 'b', eventId: 'b', status: 'COMPLETED' })
    ])

    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('bg-error/5')
  })

  // Two lines: the hop tells this row from the inbox row that shares its event
  // id, and under it where the message went — a hop either way round, so the
  // column reads as one vocabulary rather than a sentence beside a topic token.
  test('reads an outbox row as the hop it is, over where it went', async () => {
    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] > td').eq(2)

    expect(flatten(cell.text())).toBe('GAS · Outbox to Caseworking')
    expect($('[data-testid="event-hop"]').text().trim()).toBe('GAS · Outbox')
    expect($('[data-testid="event-queue"]').text().trim()).toBe(
      'to Caseworking'
    )
    expect(cell.text()).not.toContain('→')
    expect(cell.text()).not.toContain('via')
  })

  // The destination is a name; the transport it travelled on is still the raw
  // target, on the title and on the clipboard.
  test('keeps the raw target on the title behind the destination', async () => {
    const { $ } = await viewPage()

    const queue = $('[data-testid="event-queue"]')

    expect(queue.text()).toBe('to Caseworking')
    expect(queue.attr('title')).toBe('gas__sns__update_case_status_fifo')
  })

  test('reads every spelling of one topic as the same destination', async () => {
    givenEvents([event({ target: 'cw__sqs__create_new_case_fifo.fifo' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-queue"]').text()).toBe('to Caseworking')
  })

  test('names the agreements service behind its own topic', async () => {
    givenEvents([
      event({ target: 'gas__sns__update_agreement_status_fifo.fifo' })
    ])

    const { $ } = await viewPage()

    const queue = $('[data-testid="event-queue"]')

    expect(queue.text()).toBe('to Agreements')
    expect(queue.attr('title')).toBe(
      'gas__sns__update_agreement_status_fifo.fifo'
    )
  })

  // An audit row is the commonest thing on the stream, and the topic token
  // said least about it: it is a GAS outbox write onto the audit stream.
  test('reads an audit row as a GAS outbox write to Audit', async () => {
    givenEvents([event({ target: 'audit_topic_arn' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-hop"]').text().trim()).toBe('GAS · Outbox')
    expect($('[data-testid="event-queue"]').text()).toBe('to Audit')
  })

  // A topic no subscription in the platform's config names has no service on
  // the far end, so it names itself — cleaned of the publisher prefix and the
  // FIFO suffix that only repeat the hop above it.
  test('names an unsubscribed topic after itself, cleaned', async () => {
    givenEvents([
      event({ target: 'gas__sns__grant_application_created_fifo.fifo' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-queue"]').text()).toBe(
      'to grant_application_created'
    )
  })

  // An inbox row has no topic — it is a message sitting in a box — so line two
  // names the producer instead. That is the counterpart fact the hop label
  // cannot say, and it is a sentence rather than a value: nothing to copy.
  test('names the producer of an inbox row, with nothing to copy', async () => {
    givenEvents([
      event({
        service: 'caseworking',
        box: 'inbox',
        source: 'GAS',
        target: null
      })
    ])

    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] [role="cell"]').eq(3)

    expect($('[data-testid="event-hop"]').text().trim()).toBe('CW · Inbox')
    expect($('[data-testid="event-queue"]').text().trim()).toBe('from GAS')
    expect($('[data-testid="event-queue"]').attr('title')).toBeUndefined()
    expect(cell.find('[data-testid="do-copy-button"]')).toHaveLength(0)
  })

  test('names the agreements service on an inbox row it produced', async () => {
    givenEvents([event({ box: 'inbox', source: 'AS', target: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-hop"]').text().trim()).toBe('GAS · Inbox')
    expect($('[data-testid="event-queue"]').text().trim()).toBe(
      'from Agreements'
    )
  })

  // The hop is half a filter the toolbar already offers, so it is drawn as the
  // link to it: an operator who has found one bad hop can see the rest of it
  // without going back to the toolbar. Every other filter travels, and the
  // cursor does not.
  test('links the hop to the page filtered to its service', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&cursor=WHERE-I-WAS'
    )

    const hop = $('[data-testid="event-hop"]').first()

    expect(hop.is('a')).toBe(true)
    expect(hop.attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas'
    )
    expect(hop.attr('title')).toBe('Filter to GAS')
  })

  // An audit record is not a CloudEvent: it publishes no type. The id above
  // names the row on its own, so the type line is simply not drawn — no
  // placeholder, no tooltip explaining one. Everything else about the row goes
  // through the ordinary path.
  test('names a null-typed row by its id alone, with no type line', async () => {
    givenEvents([
      event({
        eventId: '665f1c2e9a1b2c3d4e5f6a7b',
        type: null,
        fullType: null,
        target: 'cw__sns__audit_fifo'
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-id"]').text()).toBe(
      '665f1c2e9a1b2c3d4e5f6a7b'
    )
    expect($('[data-testid="event-type"]')).toHaveLength(0)
    expect($('[data-testid="event-hop"]').text().trim()).toBe('GAS · Outbox')
    expect($('[data-testid="event-queue"]').text()).toBe('to Audit')
  })

  // The id is the link, so a null-typed row is as reachable as any other.
  test('keeps a null-typed row openable through its id', async () => {
    givenEvents([
      event({ eventId: '665f1c2e9a1b2c3d4e5f6a7b', type: null, fullType: null })
    ])

    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.is('a')).toBe(true)
    expect(id.attr('href')).toContain('/dev-ops/events/gas/outbox/')
  })

  // The type used to carry no title, because the column grew to fit it and a
  // tooltip repeating the text under the cursor is noise. The column is a
  // fixed share of the table now and can cut a long type, so the whole of it
  // is on the title — where a cut string has to be recoverable.
  test('keeps the whole type on the title of a column that can cut it', async () => {
    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect(type.attr('title')).toBe('case.status.updated')
    expect(type.text()).toBe('case.status.updated')
    expect(classOf(type)).toContain('truncate')
  })

  // The exception owns the row, and it does it without a pill: a red dot, a
  // label at full contrast, the faint error wash under it and — on a row that
  // has exhausted its attempts — the failure line beneath the status. Four
  // quiet marks on an otherwise calm page find the eye from across the room.
  test('marks a dead letter row red and washes the row it sits on', async () => {
    givenEvents([
      event({
        status: 'DEAD_LETTER',
        attempts: 5,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

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
      'Dead letter attempts 5/5 · 4m ago'
    )
  })

  // R5: the status already says DEAD_LETTER. The chip said it twice, in a cell
  // that was about routing.
  test('carries no DLQ chip anywhere', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-dlq"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('DLQ')
  })

  // Ghosting the done rows made a healthy page look half-broken. A completed
  // row now reads exactly like every other one, and its badge says the rest.
  test('leaves a completed row untreated', async () => {
    givenEvents([event({ status: 'COMPLETED' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
    expect($('main').html()).not.toContain('bg-error/5')
  })

  test('leaves a row in neither state untreated', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
  })

  // The one width the table declares for itself: below it the five columns of
  // ids do not fit, and the box around it scrolls instead of the page.
  test('keeps the table on daisyUI classes and one minimum width', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toBe(
      'table table-sm table-pin-rows min-w-[64rem] table-fixed'
    )
  })

  test('dots a published row quietly', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain('status')
  })

  test('dots a processing row as in flight', async () => {
    givenEvents([event({ status: 'PROCESSING' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-info'
    )
  })

  test('dots a retrying row amber and keeps the retry glyph', async () => {
    givenEvents([event({ status: 'FAILED' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'status-warning'
    )
    expect($('[data-testid="do-status-badge"]').text().trim()).toBe('Failed ↻')
  })

  // The common state recedes, but it recedes in the same anatomy as the rest.
  // Demoting it to bare text left the column with two shapes and started
  // `Completed` at a different x from `Failed`; a held-back dot and a muted
  // label say the same thing without breaking the column's left edge.
  test('holds a completed row back without changing its anatomy', async () => {
    givenEvents([event({ status: 'COMPLETED' })])

    const { $ } = await viewPage()

    const status = $('[data-testid="do-status-badge"]')

    expect(status.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status status-success'
    )
    expect($('[data-testid="do-status-label"]').attr('class')).toContain(
      'text-base-content/55'
    )
    expect(status.text().trim()).toBe('Completed')
    expect(status.attr('title')).toBe('COMPLETED')
  })

  // One anatomy for every status: the same dot, at the same x, on every row.
  // Pills gave six states six silhouettes, so the eye read the shape of a row
  // before it read the row — and the shapes shouted loudest on the states that
  // were perfectly healthy. There is no pill of any kind left on the page.
  test('gives every status the same dot-and-label anatomy, and no pill', async () => {
    givenEvents([
      event({ id: 'a', eventId: 'a', status: 'PUBLISHED' }),
      event({ id: 'b', eventId: 'b', status: 'PROCESSING' }),
      event({ id: 'c', eventId: 'c', status: 'FAILED' }),
      event({ id: 'd', eventId: 'd', status: 'DEAD_LETTER' }),
      event({ id: 'e', eventId: 'e', status: 'COMPLETED' })
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
    givenEvents([event({ status: 'QUARANTINED' })])

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="do-status-dot"]').attr('class')).toBe('status')
    expect($('[data-testid="do-status-badge"]').text()).toContain('QUARANTINED')
  })

  // Never reddened: the status dot above it already says whether being out of
  // attempts mattered, and a second red on the line said it twice.
  test('sets the attempts of a row at its maximum without reddening them', async () => {
    givenEvents([
      event({
        attempts: 5,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempts"]').text().trim()).toBe('5/5')
    expect($('[data-testid="event-failure"]').attr('class')).not.toContain(
      'text-error'
    )
  })

  // A count and a time are facts about a row's *status*, so they hang under
  // it as a second line rather than ruling a column of their own — and the
  // column they used to rule stood empty on every healthy row. `5/5` with no
  // spaces around the slash is one number; `5 / 5` was read as two.
  test('hangs the failure under the status it belongs to, as a second line', async () => {
    givenEvents([
      event({
        attempts: 5,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

    const { $ } = await viewPage()

    const detail = $('[data-testid="event-failure"]')

    expect(flatten(detail.text())).toBe('attempts 5/5 · 4m ago')
    expect(detail.closest('[data-testid="event-status"]')).toHaveLength(1)
    expect(detail.attr('class')).toContain('text-xs')
    expect(detail.attr('class')).toContain('font-mono')
    // Indented to clear the dot and its gap, so the status column keeps one
    // left edge whether a row is one line tall or two.
    expect(detail.attr('class')).toContain('pl-3')
    expect($('[data-testid="event-failure-cell"]')).toHaveLength(0)
    expect($('[data-testid="event-attempts-cell"]')).toHaveLength(0)
    expect($('[data-testid="event-last-failure-cell"]')).toHaveLength(0)
  })

  // Both halves are read together, so they are hovered together: the count in
  // words, then the two absolute spellings of the instant.
  test('carries the count in words and both absolutes on the one title', async () => {
    givenEvents([
      event({
        attempts: 5,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

    const { $ } = await viewPage()

    const title = $('[data-testid="event-failure"]').attr('title')

    expect(title).toContain('5 of 5 attempts')
    expect(title).toContain(
      '2026-06-16T10:16:05Z   ·   16 Jun 2026, 11:16:05 BST (Europe/London)'
    )
  })

  // The column is gone, and so is its heading: on a healthy page it ruled ten
  // rems of dashes to say that nothing had gone wrong on rows where nothing
  // had.
  test('names no column for failures at all', async () => {
    const { $ } = await viewPage()

    const labels = headings($)
      .toArray()
      .map((cell) => $(cell).text().trim())

    expect(labels).not.toContain('Failure')
    expect(labels).not.toContain('Attempts')
    expect(labels).not.toContain('Last failure')
  })

  // A row that has been retried but has no failure on record still has a count
  // worth reading; the half that cannot be filled says so with a dash.
  test('shows the count and a dash when a retried row records no failure', async () => {
    givenEvents([event({ attempts: 3, maxAttempts: 5, lastFailureAt: null })])

    const { $ } = await viewPage()

    expect(flatten($('[data-testid="event-failure"]').text())).toBe(
      'attempts 3/5 · —'
    )
    expect($('[data-testid="event-failure"]').attr('title')).toContain(
      '3 of 5 attempts'
    )
  })

  // `Failed` says a message did not get through and never says why, and the
  // why was two clicks away in the logs for every one of them. One line of the
  // actual error turns a page of identical amber rows into a page an operator
  // can triage without leaving it.
  test('says why the last attempt failed, under the count it belongs to', async () => {
    givenEvents([failing('connect ETIMEDOUT 10.0.3.14:443')])

    const { $ } = await viewPage()

    const reason = $('[data-testid="event-error"]')

    expect(reason.text().trim()).toBe('connect ETIMEDOUT 10.0.3.14:443')
    expect(reason.closest('[data-testid="event-status"]')).toHaveLength(1)
    expect(reason.attr('class')).toContain('text-xs')
    expect(reason.attr('class')).toContain('font-mono')
    expect(reason.attr('class')).toContain('text-error/70')
  })

  // The column holds about sixty characters, and a stack trace's worth of
  // message would make one row three lines tall. The whole of it is on the
  // title, with the error class in front of it.
  test('cuts a long reason to the width of the column, whole on the title', async () => {
    const message =
      'E11000 duplicate key error collection: gas.events index: eventId_1 dup key'

    givenEvents([failing(message)])

    const { $ } = await viewPage()

    const reason = $('[data-testid="event-error"]')

    expect(reason.text().trim()).toBe(
      'E11000 duplicate key error collection: gas.events index: eventId…'
    )
    expect(reason.attr('title')).toBe(
      `MongoServerError: ${message}\n2026-06-16T10:16:05Z   ·   16 Jun 2026, 11:16:05 BST (Europe/London)`
    )
  })

  test('says nothing about a reason on a row that has none', async () => {
    givenEvents([
      event({
        attempts: 3,
        maxAttempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-error"]')).toHaveLength(0)
    expect($('[data-testid="event-failure"]')).toHaveLength(1)
  })

  test('escapes a failure reason containing markup', async () => {
    givenEvents([failing(xss)])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-error')).toEqual(rendersAsText)
  })

  // `1/5` down twenty rows is twenty repetitions of "nothing has gone wrong",
  // and a dash on every one of them is twenty repetitions of nothing at all. A
  // row on its first attempt that never failed says nothing: the status cell
  // is one line tall and the row is as short as the rows around it.
  test('says nothing at all under the status of a row that never failed', async () => {
    const { $ } = await viewPage()

    const status = $('[data-testid="event-status"]')

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
    expect($('[data-testid="event-attempts"]')).toHaveLength(0)
    expect(flatten(status.text())).toBe('Published')
    expect(status.children()).toHaveLength(1)
  })

  // The list rows carry no trace link. Following a trace is a question about
  // one event, and it is asked on that event's own page; a link per row put an
  // external hop on every line of a list an operator scans.
  test('renders no trace link on a list row, even with a trace id', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]').text()).not.toContain('trace')
  })

  test('renders no trace link on any row of a multi-row page', async () => {
    givenLogsExplorer()
    givenEvents([
      event({ id: '1', traceId }),
      event({ id: '2', traceId: null }),
      event({ id: '3', traceId: 'cdp-request-id-1' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
  })

  // Nothing on a list row builds a Discover href now, so a hostile trace id
  // has nowhere on this page to land.
  test('puts a hostile trace id nowhere on the page at all', async () => {
    givenLogsExplorer()
    givenEvents([event({ traceId: '" onmouseover="alert(1)' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
    expect($.html()).not.toContain('onmouseover')
  })

  // The cell shows the whole id, so a hostile string reaches both the text
  // and the title — and has to arrive as text in one and stay inside the
  // attribute in the other.
  test('escapes an event id containing markup, in the cell and in its title', async () => {
    givenEvents([event({ eventId: xss })])

    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.find('script')).toHaveLength(0)
    expect(id.text()).toBe(xss)
    expect(id.attr('title')).toContain(xss)
    expect($('script')).toHaveLength(1)
  })

  test('escapes a type containing markup', async () => {
    givenEvents([event({ type: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-type')).toEqual(rendersAsText)
  })

  // The target is shown and put on a title, which is two places an unescaped
  // one would break out of. It was three until the copy button went.
  test('escapes a target containing markup, on the line and in its title', async () => {
    givenEvents([event({ box: 'outbox', source: null, target: xss })])

    const { $ } = await viewPage()

    const queue = $('[data-testid="event-queue"]')

    expect(escapingOf($, 'event-queue')).toEqual(rendersAsText)
    expect(queue.attr('title')).toBe(xss)
    expect($('script')).toHaveLength(1)
  })

  test('escapes a source containing markup', async () => {
    givenEvents([event({ box: 'inbox', source: xss, target: null })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-queue').scripts).toBe(0)
    expect($('[data-testid="event-queue"]').text()).toBe(`from ${xss}`)
    expect($('script')).toHaveLength(1)
  })

  test('escapes a status containing markup', async () => {
    givenEvents([event({ status: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'do-status-badge')).toEqual(rendersAsText)
  })

  test('escapes an unavailable source name containing markup', async () => {
    givenEvents([event()], {}, [
      { service: xss as unknown as 'gas', box: 'inbox', message: 'timeout' }
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
          segregationRef: xss,
          target: xss,
          status: xss
        })
      ],
      {},
      [{ service: xss as unknown as 'gas', box: 'inbox', message: xss }]
    )

    const { $ } = await viewPage()

    // The layout's own module script is the only one a correct page carries.
    expect($('script')).toHaveLength(1)
    expect($('script').attr('type')).toBe('module')
  })

  test('links Newer and Older to the cursors the endpoint issued', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage()

    // The list is newest first, so the backward cursor walks towards the
    // events that arrived after these and the forward one towards the ones
    // before. That is what the two labels say, and it is why they say time
    // rather than page order.
    expect($('[data-testid="do-pager-newer"]').attr('href')).toBe(
      '/dev-ops/events?cursor=START&direction=backward'
    )
    expect($('[data-testid="do-pager-older"]').attr('href')).toBe(
      '/dev-ops/events?cursor=END&direction=forward'
    )
    expect($('[data-testid="do-pager-newer"]').text()).toBe('← Newer')
    expect($('[data-testid="do-pager-older"]').text()).toBe('Older →')
  })

  test('keeps the status filter on both links', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="do-pager-newer"]').attr('href')).toContain(
      'status=DEAD_LETTER'
    )
    expect($('[data-testid="do-pager-older"]').attr('href')).toContain(
      'status=DEAD_LETTER'
    )
  })

  test('keeps the service filter on both links', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage('/dev-ops/events?service=gas')

    expect($('[data-testid="do-pager-newer"]').attr('href')).toContain(
      'service=gas'
    )
    expect($('[data-testid="do-pager-older"]').attr('href')).toContain(
      'service=gas'
    )
  })

  test('links no Newer on the newest page, and holds its place', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-newer"]')).toHaveLength(0)
    expect($('[data-testid="do-pager-newer-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-older"]')).toHaveLength(1)
  })

  test('links no Older on the oldest page, and holds its place', async () => {
    givenEvents([event()], { startCursor: 'START', hasPreviousPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-older"]')).toHaveLength(0)
    expect($('[data-testid="do-pager-older-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-newer"]')).toHaveLength(1)
  })

  test('omits the pager when there are no events', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(0)
  })

  // The footer counts nothing now. `20 events` under a page of twenty was a
  // fact about a window, in the smallest type on the card, under a toolbar
  // whose segments carry the facts about the whole stream — two kinds of
  // arithmetic inches apart, inviting the smaller to be read as the larger.
  test('counts nothing in the footer', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-count"]')).toHaveLength(0)
    expect($('[data-testid="do-pager"]').text()).not.toContain('event')
    expect($('[data-testid="do-pager"]').text()).not.toContain('group')
  })

  // The bar is the table's bottom edge as well as its control: without it the
  // last row simply falls off the card.
  test('draws the bottom edge on a page with no links at all', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(1)
    expect($('[data-testid="do-pager"] a')).toHaveLength(0)
    expect($('[data-testid="do-pager-newer-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-older-disabled"]')).toHaveLength(1)
  })

  test('names the unavailable sources when Caseworking is not configured', async () => {
    givenEvents([event()], {}, [
      { service: 'caseworking', box: 'inbox', message: 'not configured' },
      { service: 'caseworking', box: 'outbox', message: 'not configured' }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]').text().trim()).toBe(
      'Some event sources are unavailable: CW · Inbox, CW · Outbox. Showing the rest.'
    )
    expect($('[data-testid="event-row"]')).toHaveLength(1)
  })

  test('names a GAS source when one GAS read failed', async () => {
    givenEvents(
      [event({ box: 'inbox', source: 'CW', target: null }), event()],
      {},
      [{ service: 'gas', box: 'outbox', message: 'read error' }]
    )

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]').text()).toContain('GAS · Outbox')
    expect($('[data-testid="event-row"]')).toHaveLength(2)
  })

  test('keeps the pager working on a partial page', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true }, [
      { service: 'caseworking', box: 'inbox', message: 'timeout' }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-partial"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-older"]')).toHaveLength(1)
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
      { service: 'caseworking', box: 'inbox', message: 'not configured' }
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

  // An outage is a state of the result set like any other, so it is reported
  // inside the frame the result set lives in. It used to have no card at all,
  // which left the toolbar floating over an empty screen under a red strip.
  test('reports an outage inside the same card frame', async () => {
    givenUnavailable()

    const { $ } = await viewPage()

    const card = $('[data-testid="events-card"]')

    expect(card).toHaveLength(1)
    expect(card.attr('class')).toContain('flex-1')
    expect(card.find('[data-testid="events-error"]')).toHaveLength(1)
    expect($('[data-testid="events-empty"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]')).toHaveLength(0)
    // Not a strip above the toolbar any more.
    expect(
      $('[data-testid="events-toolbar"]').find('[data-testid="events-error"]')
    ).toHaveLength(0)
  })

  // The document does not scroll: the page is the viewport, and the rows
  // travel inside the card while the toolbar above them stays put.
  test('scrolls the table inside its own container, not the page', async () => {
    const { $ } = await viewPage()

    const scroller = $('[data-testid="events-scroller"]')

    expect(scroller.hasClass('overflow-y-auto')).toBe(true)
    expect(scroller.hasClass('overflow-x-auto')).toBe(true)
    // It takes whatever height the card has left, and gives none of it back.
    expect(scroller.hasClass('flex-1')).toBe(true)
    expect(scroller.hasClass('min-h-0')).toBe(true)
    expect(scroller.find('[data-testid="events-table"]')).toHaveLength(1)
    expect($('body').attr('class')).toContain('h-dvh')
    expect($('body').attr('class')).toContain('overflow-hidden')
  })

  test('keeps the table wide enough for its four columns to scroll', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').attr('class')).toContain(
      'min-w-[64rem]'
    )
  })

  // A card, and one that fills what the viewport has left: three rows in a
  // card that stops after three rows reads as a page that failed to draw.
  test('frames the table in a bordered card that fills the viewport', async () => {
    const { $ } = await viewPage()

    const card = $('[data-testid="events-card"]')

    expect(card.attr('class')).toContain('card card-border')
    expect(card.attr('class')).toContain('bg-base-100')
    expect(card.attr('class')).toContain('flex-1')
    expect(card.attr('class')).toContain('min-h-0')
    expect(card.find('[data-testid="events-scroller"]')).toHaveLength(1)
  })

  test('keeps the pager inside the card, below the table', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage()

    const pager = $('[data-testid="events-card"] [data-testid="do-pager"]')

    expect(pager).toHaveLength(1)
    expect(
      $('[data-testid="events-scroller"] [data-testid="do-pager"]')
    ).toHaveLength(0)
    expect(pager.prev().attr('data-testid')).toBe('events-scroller')
    expect($('[data-testid="do-pager-newer"]').text()).toBe('← Newer')
    expect($('[data-testid="do-pager-older"]').text()).toBe('Older →')
    expect($('[data-testid="do-pager"]').text()).not.toContain('Previous')
    expect($('[data-testid="do-pager"]').text()).not.toContain('Next')
  })

  // The directions are no use to an operator who has to scroll twenty rows to
  // reach them. The bar sits under the scroll box, at the foot of a card that
  // is as tall as the viewport, and never gives its height back to the rows.
  test('holds the pager at the foot of the card', async () => {
    const { $ } = await viewPage()

    const pager = $('[data-testid="do-pager"]')

    expect(pager.hasClass('shrink-0')).toBe(true)
    expect(pager.attr('class')).toContain('border-t border-base-300')
  })

  // The pair never moves. A footer that renders only the link it has slides
  // Next across the row the moment Previous appears, so the button an operator
  // is aiming at is somewhere else on the very next page.
  test('holds both directions in place, muting the one there is no page in', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"] a')).toHaveLength(1)
    expect($('[data-testid="do-pager"] a').attr('rel')).toBe('next')

    const newer = $('[data-testid="do-pager-newer-disabled"]')

    expect(newer.is('span')).toBe(true)
    expect(newer.attr('href')).toBeUndefined()
    expect(newer.attr('class')).toContain('btn-disabled')
    expect(newer.text()).toBe('← Newer')
  })

  // The list writes nothing at all any more. Every form on it is a GET — the
  // search and the range — the two POSTs it used to carry went with the batch
  // redrive, and every write in the app is now made from one event's own page.
  test('writes nothing: no post, no select, no checkbox, no row action', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('main select')).toHaveLength(0)
    expect($('main [role="tablist"]')).toHaveLength(0)
    expect($('main form[method="post"]')).toHaveLength(0)
    expect($('main form[method="get"]')).toHaveLength(2)
    expect($('main [type="checkbox"]')).toHaveLength(0)
    expect($('main [form]')).toHaveLength(0)
    // Search, the button that opens the range panel, and Apply inside it.
    // None of the three writes anything.
    expect(
      $('main button:not([data-testid="do-copy-button-control"])')
    ).toHaveLength(3)
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

  // Header source chips and the "sources n of 4" badge are canvas
  // exploration: the alert is the whole of this page's source reporting.
  test('reports source health with the alert alone', async () => {
    givenEvents([event()], {}, [
      { service: 'caseworking', box: 'inbox', message: 'not configured' }
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="events-heading"]').text()).not.toContain('sources')
    expect($('[data-testid="events-heading"] .badge')).toHaveLength(0)
    expect($('[data-testid="events-partial"]')).toHaveLength(1)
  })

  // The strip reports what this page counted, and says when it counted it. It
  // used to end in a standing caveat that the read replica might be a few
  // seconds behind — a sentence on every render, about nothing that had
  // happened, that an operator had read once and could not act on either way.
  test('says nothing about a read replica, and floats nothing under the card', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-lag-note"]')).toHaveLength(0)
    expect($('[data-testid="events-rollup"]').text()).not.toContain('secondary')
    expect($('main').text()).not.toContain('may lag')
    expect($('[data-testid="events-footnote"]')).toHaveLength(0)
    expect($('[data-testid="events-card"]').next()).toHaveLength(0)
  })

  // The navbar named the deployable, in kebab case. It names the product now,
  // with the app it is showing as a quiet suffix; the repo name still titles
  // the tab, which is the one place it earns its keep.
  test('brands the header with the product and the app', async () => {
    const { $ } = await viewPage()

    const brand = $('[data-testid="do-brand"]')
    const suffix = $('[data-testid="do-brand-suffix"]')

    expect(flatten(`${brand.text()} ${suffix.text()}`)).toBe(
      'Grants Platform · Dev Ops'
    )
    expect(brand.attr('class')).toContain('font-bold')
    expect(brand.attr('href')).toBe('/dev-ops')
    expect(suffix.attr('class')).toContain('text-base-content/50')
    expect(brand.closest('.navbar-start')).toHaveLength(1)
    expect($('header').attr('class')).toContain('navbar')
    expect(brand.text()).not.toContain('fg-grants-platform-admin')
  })

  // The type is the row's first word and the thing an operator points at when
  // they want the whole of this event. The id and the reference beside it keep
  // answering the other question, at `?q=`.
  test('links the event id at the page for that one event', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.is('a')).toBe(true)
    expect(id.attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b'
    )
    expect(id.attr('class')).toContain('link link-hover')
    expect(id.attr('class')).toContain('font-semibold')
  })

  test('leaves the type beneath it as plain text, not a second link', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-type"]').is('a')).toBe(false)
  })

  // The operator is going one row deep and coming straight back: returning
  // them to page one of an unfiltered list is losing their place.
  test('carries the whole list query onto the id link', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&cursor=END&q=gld-9b2'
    )

    expect($('[data-testid="event-id"]').attr('href')).toBe(
      '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7b?from=' +
        encodeURIComponent(
          '?status=DEAD_LETTER&service=gas&cursor=END&q=gld-9b2'
        )
    )
  })

  test('carries no from at all off an unfiltered list', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-id"]').attr('href')).not.toContain('from=')
  })

  test('links the id of every member of an open group', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const links = $('[data-testid="event-row"] [data-testid="event-id"]')

    expect(links).toHaveLength(3)
    links.toArray().forEach((link) => {
      expect($(link).attr('href')).toContain('/dev-ops/events/gas/outbox/')
    })
  })

  // A summary standing for eight rows has no one event to point at, so nothing
  // in it opens a row: the reference link filters the list, which is a question
  // about the group rather than about any member of it.
  test('leaves the group summary type as plain text', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const summaryType = $(
      '[data-testid="event-group-summary"] > [role="cell"] [data-testid="event-type"]'
    )

    expect(summaryType.is('a')).toBe(false)
  })

  test('escapes an event type carrying markup', async () => {
    givenEvents([event({ type: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-type')).toEqual(rendersAsText)
  })

  // The id opens the row, and it is the only link the identity cell has left.
  test('points the id at the row, the one link the cell carries', async () => {
    const { $ } = await viewPage()
    const cell = $('[data-testid="event-row"] > td').eq(0)

    expect(cell.find('a')).toHaveLength(1)
    expect($('[data-testid="event-id"]').attr('href')).toContain(
      '/dev-ops/events/gas/outbox/'
    )
  })

  // `22m ago` is the right first reading and the wrong thing to match against
  // a log line, and the absolute was on a tooltip nobody hovers while scanning.
  test('puts the wall clock under the relative age', async () => {
    const { $ } = await viewPage()

    const clock = $('[data-testid="event-created-clock"]')

    expect(clock.text().trim()).toBe('10:00:00')
    expect(clock.attr('class')).toContain('font-mono')
    expect(clock.attr('class')).toContain('text-xs')
    expect(clock.attr('class')).toContain('text-base-content/40')
    expect(clock.attr('title')).toBe(
      '2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)'
    )
  })

  // Past a day the date arrives and the seconds go: `14 Jun 08:18` places a
  // row a keyset window has reached back to, and a bare `08:18:01` on the same
  // row read as this morning to anybody scanning.
  test('dates the wall clock once the row is more than a day old', async () => {
    givenEvents([event({ createdAt: '2026-06-14T08:18:01.000Z' })])

    const { $ } = await viewPage()

    const clock = $('[data-testid="event-created-clock"]')

    expect(flatten(clock.text())).toBe('14 Jun 08:18')
    expect(clock.attr('title')).toBe(
      '2026-06-14T08:18:01Z   ·   14 Jun 2026, 09:18:01 BST (Europe/London)'
    )
    // No copy button: two spellings are on the row already and the whole
    // instant is a click away on the row's own page.
    expect(clock.find('[data-testid="do-copy-button"]')).toHaveLength(0)
  })

  // The line under the status is read to see whether a row is still moving,
  // never to be pasted anywhere, so it stays relative — and keeps both
  // absolute spellings on its title, where an unquotable figure has to.
  test('keeps the status sub-lines relative, with the instants on their titles', async () => {
    givenEvents([failing('E11000 duplicate key error collection: gas.events')])

    const { $ } = await viewPage()

    const failure = $('[data-testid="event-failure"]')

    expect(flatten(failure.text())).toBe('attempts 5/5 · 4m ago')
    expect(failure.attr('title')).toContain('2026-06-16T10:16:05Z')
    expect(failure.attr('title')).toContain('Europe/London')
    expect($('[data-testid="event-error"]').attr('title')).toContain(
      '2026-06-16T10:16:05Z'
    )
  })

  test('keeps the relative age exactly as it was above it', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-created-at"]').text().trim()).toBe('20m ago')
    expect($('[data-testid="event-created-at"]').attr('title')).toBe(
      '2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)'
    )
  })

  // The stamp was a caveat about a page that no longer reloads itself: with
  // the automatic reload gone, a tab is only ever as old as the last time
  // somebody asked for it, and every row already carries its own clock.
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

  test('sets Sign out as a small quiet button, beside the theme toggle', async () => {
    const { $ } = await viewPage()

    const signOut = $('header a[href="/auth/logout"]')

    expect(signOut.attr('class')).toBe('btn btn-ghost btn-sm')
    expect($('header do-theme-toggle')).toHaveLength(1)
  })

  // The two boxes are still the two boxes; they have moved from the search row
  // into the time-range panel, where they sit under the preset ladder in a
  // form of their own.
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
    // `datetime-local` shows the browser's own clock and submits a bare wall
    // time; the route reads it as UTC. The page says so nowhere: every instant
    // it draws is UTC, and a label repeated beside each one is a label nobody
    // reads.
    expect(flatten($('[data-testid="events-range-from-label"]').text())).toBe(
      'From'
    )
    expect(flatten($('[data-testid="events-range-to-label"]').text())).toBe(
      'To'
    )
    expect(
      flatten($('[data-testid="events-range-absolute-heading"]').text())
    ).toBe('Absolute range')
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

  // The boxes hold what the page is actually asking about, whether it was
  // typed here or arrived on a shared url as an instant.
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

  // The window is said once, on the TIME button, and the button is also the way
  // out of it. The strip below used to carry a second copy of both, back when
  // the range had no control of its own showing its value.
  test('says the window on the button and nowhere in the strip', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&status=FAILED&cursor=END'
    )

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      '2026-06-16 09:00 → now'
    )
    expect($('[data-testid="events-note-range"]')).toHaveLength(0)
    expect($('[data-testid="events-note-range-clear"]')).toHaveLength(0)
  })

  test('names the earlier end when only the later one was given', async () => {
    const { $ } = await viewPage('/dev-ops/events?to=2026-06-16T10:00')

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'earliest → 2026-06-16 10:00'
    )
  })

  // The strip is the search and the failure now, and nothing else.
  test('draws no strip at all on a page narrowed only by its window', async () => {
    const { $ } = await viewPage('/dev-ops/events?from=2026-06-16T09:00')

    expect($('[data-testid="events-filter-notes"]')).toHaveLength(0)
  })

  test('keeps the range on every filter segment', async () => {
    const { $ } = await viewPage('/dev-ops/events?from=2026-06-16T09:00')

    expect(
      segmentFor($, 'events-filter-status-chip', 'DEAD_LETTER').attr('href')
    ).toBe(
      '/dev-ops/events?status=DEAD_LETTER&from=2026-06-16T09%3A00%3A00.000Z'
    )
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('href')
    ).toBe('/dev-ops/events?service=gas&from=2026-06-16T09%3A00%3A00.000Z')
  })

  // The boxes have left the search form, so the window has to travel through a
  // search as hidden fields or searching would quietly widen the page to all
  // time. `range` goes with it, or the button would forget which rung it is on.
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

  // And the absolute form carries the search the other way, but never the
  // window or its label: applying a window of your own is exactly what stops
  // the page being `Last 24h`.
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

  // The batch redrive is gone, and with it every mark it put on this page: no
  // checkbox on a dead letter, no form around the table, no `Redrive selected`
  // button reaching into it by `form=`. A dead letter is redriven from its own
  // page, where the operator can see what they are about to put back.
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
    // The row still opens the one page a redrive can be made from.
    expect($('[data-testid="event-id"]').first().attr('href')).toContain(
      '/dev-ops/events/gas/outbox/'
    )
  })

  // A queue's whole job is to be quick, and `Completed` never said how quick.
  test.each([
    [
      'under a second, in milliseconds',
      '2026-06-16T10:00:00.430Z',
      'took 430ms'
    ],
    ['under a minute, to a tenth', '2026-06-16T10:00:01.200Z', 'took 1.2s'],
    [
      'past a minute, in minutes and seconds',
      '2026-06-16T10:03:12.000Z',
      'took 3m 12s'
    ]
  ])(
    'reports how long a completed row took %s',
    async (_name, completedAt, said) => {
      givenEvents([event({ status: 'COMPLETED', completedAt })])

      const { $ } = await viewPage()

      expect($('[data-testid="event-latency"]').text().trim()).toBe(said)
    }
  )

  test('says nothing about latency on a row that has not completed', async () => {
    givenEvents([event({ status: 'PUBLISHED', completedAt: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-latency"]')).toHaveLength(0)
  })

  // Every instant this page draws is UTC, so it says so nowhere: a zone label
  // repeated beside each of forty figures is a word nobody reads. The whole
  // page is swept, attributes included, because a title is visible too — the
  // only `UTC` left in the app is the `timeZone` the formatters are built with
  // and the trailing `Z` on an ISO value, which is the format, not a label.
  test('writes no UTC label anywhere on the page', async () => {
    givenBreakdown([group()], {}, [event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-16T09:00&to=2026-06-16T10:00&q=gld-9b2'
    )

    // The range panel, the clock line and the strip are all in this markup.
    expect($('main').html()).not.toContain('UTC')
    expect($('[data-testid="events-range-panel"]').html()).not.toContain('UTC')
  })

  // The instant under the relative age is the one an operator matches against
  // a log line. It wears no zone: every instant the page draws is UTC, and the
  // title beside it carries the ISO spelling, `Z` and all, for anyone matching.
  test('draws the wall clock bare, with the instant on its title', async () => {
    const { $ } = await viewPage()
    const clock = $('[data-testid="event-created-clock"]')

    expect(clock.text().trim()).toBe('10:00:00')
    expect(clock.attr('title')).toBe(
      '2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)'
    )
  })

  // The toolbar's right-hand corner is for the controls that *write*, and
  // nothing else. A page reloading itself every thirty seconds is something a
  // browser does; a page that offered to do it put a control for it beside the
  // one button on the screen that queues seven thousand messages.
  test('offers no reload controls at all', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="events-refresh"]')).toHaveLength(0)
    expect($('[data-testid="events-live"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Refresh')
    expect($('main').text()).not.toContain('Auto')
  })

  // The card header holds the caption and nothing else now: the two bulk
  // buttons that used to sit beside it went with the batch redrive.
  test('keeps the card header to the failures summary and the total', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const aside = $('[data-testid="events-card-aside"]')

    expect(
      aside
        .children()
        .toArray()
        .map((child) => $(child).attr('data-testid'))
    ).toEqual(['events-total'])
  })

  // Nothing on the page turns it over on a timer any more, so nothing goes in
  // the head at all.
  test('puts no meta refresh in the head', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect($('meta[http-equiv="refresh"]')).toHaveLength(0)
  })

  // `live` rode every filter link and every hidden field so a reload survived
  // a filter change. It is not one of the page's parameters any more, so the
  // links carry the filters and nothing else.
  test('threads no reload parameter through its links or its hidden fields', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=FAILED')

    expect(
      segmentFor($, 'events-filter-status-chip', 'DEAD_LETTER').attr('href')
    ).toBe('/dev-ops/events?status=DEAD_LETTER')
    expect(
      $('[data-testid="events-search-filter"]')
        .toArray()
        .map((field) => [$(field).attr('name'), $(field).attr('value')])
    ).toEqual([['status', 'FAILED']])
    expect($('main').html()).not.toContain('live=')
  })

  // A bookmarked `?live=30` is now a parameter this route has never heard of,
  // and it is refused exactly as any other unknown one is rather than being
  // quietly forwarded to an endpoint that never took it either.
  test('refuses a reload parameter left over on a bookmarked url', async () => {
    const { statusCode } = await viewPage(
      '/dev-ops/events?live=30&status=FAILED'
    )

    expect(statusCode).toBe(400)
    expect(getEventsUseCase).not.toHaveBeenCalled()
  })

  // Which failures the dead letters actually are, folded above the table. The
  // list is one keyset window ordered by time, and the shape of an incident is
  // spread across three hundred pages of it.
  // With the strip gone the panel is the first thing in the card: it sits
  // directly between the toolbar and the table it is a summary of, which is
  // where a summary of a table belongs.
  test('sits the failures panel directly above the table, open on a dead-letter page', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')
    const children = $('[data-testid="events-card"] > *')
      .toArray()
      .map((child) => $(child).attr('data-testid'))

    expect(children).toEqual([
      'events-card-header',
      'events-scroller',
      'do-pager'
    ])
    expect($('[data-testid="events-failures"]').attr('open')).toBeDefined()
    expect(
      $('[data-testid="events-card-header"]')
        .next()
        .find('[data-testid="events-table"]')
    ).toHaveLength(1)
  })

  // One row, not two strips of chrome before a single row of data. The
  // disclosure is only as wide as its own words, so the figure beside it is
  // not part of the click target; the chevron sits against the label rather
  // than a hand's breadth away at the far edge, where it would land under the
  // caption.
  test('merges the failures summary and the total into one row', async () => {
    givenBreakdown()

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const header = $('[data-testid="events-card-header"]')
    const summary = $('[data-testid="events-failures-summary"]')

    expect(header.attr('class')).toContain('shrink-0')
    expect(header.children()).toHaveLength(2)
    expect(header.find('[data-testid="events-failures"]')).toHaveLength(1)
    expect(header.find('[data-testid="events-total"]')).toHaveLength(1)
    // The caption is not inside the summary, so clicking it toggles nothing.
    expect(summary.find('[data-testid="events-total"]')).toHaveLength(0)
    expect($('[data-testid="events-total"]').closest('summary')).toHaveLength(0)
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

  // The total is the one figure that answers to every filter at once, so it
  // survives a page with no failures panel to sit beside — as the row itself.
  test('keeps the total row on a page with no failures panel', async () => {
    givenEvents([event()])

    const { $ } = await viewPage()

    const total = $('[data-testid="events-total"]')

    expect($('[data-testid="events-failures"]')).toHaveLength(0)
    expect($('[data-testid="events-card-header"]')).toHaveLength(1)
    expect(total).toHaveLength(1)
    expect(total.closest('[data-testid="events-card-aside"]')).toHaveLength(1)
  })

  // Folded shut it is one line, and it still keeps its own summary: a page an
  // operator opened to look at something else should not have the queue's
  // worst day pushed into it, but it should say the summary is there.
  test('keeps the panel to its own summary line while it is folded', async () => {
    givenBreakdown([group()], {}, [event()])

    const { $ } = await viewPage()

    const panel = $('[data-testid="events-failures"]')

    expect(panel.attr('open')).toBeUndefined()
    expect(flatten($('[data-testid="events-failures-summary"]').text())).toBe(
      'Top failures (1 group)'
    )
    // It shares its line with the total, and the row they share is the one
    // ruled off from the table below it.
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
      'Top failures (1 group)'
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

    expect(flatten($('[data-testid="events-failure-row"]').text())).toBe(
      'E11000 duplicate key error collection: gas.events index: eventId_1 case.status.updated 4,182 first 1d ago last 4m ago'
    )
  })

  test('links each failure row at the page narrowed to that failure', async () => {
    givenBreakdown()

    const { $ } = await viewPage(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&cursor=END'
    )

    // The row is a table row now, so the link is the message inside it — the
    // one cell that names the failure the link narrows to.
    expect($('[data-testid="events-failure-message"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+eventId_1'
    )
    expect($('[data-testid="events-failure-row"]').is('tr')).toBe(true)
  })

  // The failure message names the group here; the type is the extra fact. A
  // group of rows that store none — audit records — leaves the cell empty
  // rather than standing something in for it.
  test('leaves the failures panel type cell empty for a null group type', async () => {
    givenBreakdown([group({ type: null })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const type = $('[data-testid="events-failure-type"]')

    expect(type.text()).toBe('')
    expect($('[data-testid="events-failure-row"]').text()).not.toContain('n/a')
  })

  // `?error=` matches a message, and a group with none cannot be isolated by
  // it. The link is honest about what it does, and the panel says why.
  test('links a failure group with no error at the dead letters, and says so', async () => {
    givenBreakdown([group({ error: null, count: 12 })])

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect(flatten($('[data-testid="events-failure-message"]').text())).toBe(
      '(no error recorded)'
    )
    expect($('[data-testid="events-failure-message"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER'
    )
    expect(flatten($('[data-testid="events-failures-note"]').text())).toContain(
      'cannot be isolated'
    )
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
        .map((link) => [$(link).text(), $(link).attr('href')])
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
  // closes it on Escape and on a click anywhere else, and hands focus back to
  // the button. That was the whole job of the custom element this replaced,
  // and there is no element left to define.
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

  test('says Any time on the button of a page with no window', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="events-range-button"]')

    expect(flatten(button.text())).toBe('Any time')
    expect(button.attr('title')).toBe('Time range: Any time')
    // A clock in front of the label and a chevron after it: the button says
    // what it is about, and that it opens something.
    expect(button.find('[data-testid="do-icon-clock"]')).toHaveLength(1)
    expect(button.find('[data-testid="do-icon-chevron-down"]')).toHaveLength(1)
  })

  test('says the preset back on the page its link opens', async () => {
    const { $ } = await viewPage(
      '/dev-ops/events?from=2026-06-15T10:19:57.000Z&range=24h'
    )

    expect(flatten($('[data-testid="events-range-button"]').text())).toBe(
      'Last 24h'
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
      '2026-09-01 00:00 → 2026-09-02 00:00'
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
      segmentFor($, 'events-filter-status-chip', 'DEAD_LETTER').attr('href')
    ).toContain('range=24h')
    expect(
      segmentFor($, 'events-filter-service-chip', 'gas').attr('href')
    ).toContain('range=24h')
  })

  // The state is gone from the app: no segment, no row line, no vocabulary.
  test('says nothing about parking anywhere on the list', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-parked"]')).toHaveLength(0)
    expect(segments($, 'events-filter-status-chip')).not.toContain('Parked')
    expect($('main').text()).not.toContain('Parked')
    expect($('main').html()).not.toContain('PARKED')
  })
})
