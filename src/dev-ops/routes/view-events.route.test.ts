import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  Event,
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
  target: 'cw__sns__update_status_fifo',
  segregationRef: 'GLD-9B2-BWS-grasslands',
  status: 'PUBLISHED',
  attempts: 1,
  maxAttempts: 5,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: null,
  completedAt: null,
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

const givenEvents = (
  events: Event[] = [event()],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
) =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events, pagination: pagination(overrides), sourceErrors },
    unavailable: false
  })

const givenUnavailable = () =>
  vi.mocked(getEventsUseCase).mockResolvedValue({
    page: { events: [], pagination: pagination(), sourceErrors: [] },
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
 * The class every line of the table wears: the shared grid template, and the
 * hover tint that is a row's whole state.
 */
const rowClass = 'do-events-row hover:bg-base-200/60'

/**
 * The identity line is set with real spaces around its separators, so the
 * markup carries non-breaking ones. Every assertion on cell text reads them
 * back as the ordinary spaces they look like.
 */
const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const headings = ($: CheerioAPI) =>
  $('[data-testid="events-table"] [role="columnheader"]')

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

  test('forwards a status the endpoint does not know', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?status=BOGUS')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ status: 'BOGUS' })
  })

  test('forwards a service the endpoint does not know', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?service=other')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ service: 'other' })
  })

  test('forwards a direction the endpoint does not know', async () => {
    const { statusCode } = await viewPage('/dev-ops/events?direction=sideways')

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventsUseCase).toHaveBeenCalledWith({ direction: 'sideways' })
  })

  test('shows the error alert when the endpoint refuses the query', async () => {
    givenUnavailable()

    const { statusCode, $ } = await viewPage('/dev-ops/events?status=BOGUS')

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
      'Inbox and outbox messages across GAS and Caseworking.'
    )
    expect($('main').text()).not.toContain('No filter applied')
    expect($('main').text()).not.toContain('Filtered:')
  })

  // Sentence case throughout the toolbar: nothing in it shouts, labels
  // included, and the badges below say the same six words the same way.
  test('offers a chip for every status and every service', async () => {
    const { $ } = await viewPage()

    const chips = (testId: string) =>
      $(`[data-testid="${testId}"]`)
        .toArray()
        .map((chip) => $(chip).text().trim())

    expect(chips('events-filter-status-chip')).toEqual([
      'All',
      'Published',
      'Processing',
      'Failed',
      'Resubmitted',
      'Completed',
      'Dead letter'
    ])
    expect(chips('events-filter-service-chip')).toEqual([
      'All',
      'GAS',
      'Caseworking'
    ])
  })

  test('renders each filter group as a join of extra small buttons', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filter-status"]').hasClass('join')).toBe(
      true
    )
    expect($('[data-testid="events-filter-service"]').hasClass('join')).toBe(
      true
    )
    expect(
      $('[data-testid="events-filter-status-chip"]').first().attr('class')
    ).toContain('btn join-item btn-xs')
  })

  // A strip stretched to the width of the page drew a border around nine
  // buttons and 700px of nothing. The toolbar shrink-wraps what it holds now,
  // and carries no border of its own: each group is outlined already.
  test('shrink-wraps the toolbar and gives it no border of its own', async () => {
    const { $ } = await viewPage()

    const toolbar = $('[data-testid="events-filters"]')

    expect(toolbar).toHaveLength(1)
    expect(toolbar.attr('class')).toContain('w-fit')
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
      expect(group.attr('class')).toBe('join rounded-md border border-base-300')
    })
    expect($('[data-testid="events-filter-divider"]')).toHaveLength(0)
  })

  // The labels name the two groups; the chips are the options. Ten pixels, in
  // capitals and muted, is what tells the eye which of the two it is looking
  // at — set as prose, `Status` read as a chip nobody could click.
  test('sets the toolbar labels apart from the chips they introduce', async () => {
    const { $ } = await viewPage()

    const labels = $('[data-testid="events-filter-label"]')
      .toArray()
      .map((label) => $(label))

    expect(labels.map((label) => label.text().trim())).toEqual([
      'Status',
      'Service'
    ])
    labels.forEach((label) => {
      expect(label.attr('class')).toContain('text-[10px]')
      expect(label.attr('class')).toContain('uppercase')
      expect(label.attr('class')).toContain('tracking-wide')
      expect(label.attr('class')).toContain('text-base-content/50')
    })
  })

  // A label and the segments it introduces are one object. Spaced alike in a
  // single row, there was as much air between `Status` and its own control as
  // between the two controls, and the toolbar read as four things.
  test('keeps each label with its own group, and the groups apart', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-filters"]').attr('class')).toContain(
      'gap-x-6'
    )

    const pairs = $('[data-testid="events-filters"] > div')

    expect(pairs).toHaveLength(2)
    pairs.toArray().forEach((pair) => {
      expect($(pair).attr('class')).toContain('gap-x-2')
      expect($(pair).find('[data-testid="events-filter-label"]')).toHaveLength(
        1
      )
    })
    expect(
      pairs.first().find('[data-testid="events-filter-status"]')
    ).toHaveLength(1)
    expect(
      pairs.last().find('[data-testid="events-filter-service"]')
    ).toHaveLength(1)
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

  // Marked, not filled. A solid neutral segment put the heaviest object on
  // the page in the toolbar, above a table set in 11 and 12px, and the filter
  // bar outweighed the data it was filtering.
  test('marks the segment the page is filtered to without filling it', async () => {
    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    const active = $('[data-testid="events-filter-status-chip"][aria-current]')

    expect(active.attr('class')).toBe(
      'btn join-item btn-xs btn-ghost do-segment-active bg-base-content/10 font-medium text-base-content'
    )
    expect(active.attr('class')).not.toContain('btn-neutral')
    expect(active.text().trim()).toBe('Dead letter')

    const inactive = $('[data-testid="events-filter-status-chip"]').first()

    expect(inactive.attr('class')).toBe(
      'btn join-item btn-xs btn-ghost font-normal text-base-content/70'
    )
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
      .map((chip) => $(chip).text().trim())

    expect(active).toEqual(['All', 'All'])
  })

  // Every chip is a link the server rendered: the page carries no script that
  // could build one.
  test('renders every chip as a link that keeps the other filter', async () => {
    const { $ } = await viewPage('/dev-ops/events?service=gas')

    const hrefOf = (label: string) =>
      $('[data-testid="events-filter-status-chip"]')
        .toArray()
        .map((chip) => $(chip))
        .find((chip) => chip.text().trim() === label)
        ?.attr('href')

    expect(hrefOf('Failed')).toBe('/dev-ops/events?status=FAILED&service=gas')
    expect(hrefOf('All')).toBe('/dev-ops/events?service=gas')
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

  test('sets the table header small, quiet and uppercase', async () => {
    const { $ } = await viewPage()

    const heading = headings($).eq(1)

    expect(heading.attr('class')).toContain('text-[11px]')
    expect(heading.attr('class')).toContain('uppercase')
    expect(heading.attr('class')).toContain('text-base-content/45')
  })

  // Figures are read against their own right edge, so the one column of them
  // is right-aligned in the header as well as in the body.
  test('right-aligns the column of figures, header and cells', async () => {
    givenEvents([event({ lastFailureAt: '2026-06-16T10:16:05.000Z' })])

    const { $ } = await viewPage()

    const heads = headings($)

    expect(heads.eq(4).attr('class')).toContain('text-right')
    expect(heads.eq(1).attr('class')).not.toContain('text-right')
    expect(heads.eq(2).attr('class')).not.toContain('text-right')
    expect(heads.eq(3).attr('class')).not.toContain('text-right')

    const cells = $('[data-testid="event-row"]').first().find('[role="cell"]')

    expect(cells.eq(4).attr('class')).toContain('text-right')
    expect(cells.eq(1).attr('class')).not.toContain('text-right')
    expect(cells.eq(2).attr('class')).not.toContain('text-right')
    expect(cells.eq(3).attr('class')).not.toContain('text-right')
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

  // Four columns and the disclosure gutter that heads the carets. Failure was
  // a fifth, and on a healthy page it was a ruled column of dashes: a count
  // and a time are facts about a row's *status*, so they hang under the status
  // instead, and the width the column gave up went to Event and Route.
  test('heads the table with the gutter and the four columns in order', async () => {
    const { $ } = await viewPage()

    expect(
      headings($)
        .toArray()
        .map((cell) => $(cell).text().trim())
    ).toEqual(['', 'Event', 'Status', 'Route', 'Created'])
  })

  test('adds no further column for actions, counts, failures or a source chip', async () => {
    const { $ } = await viewPage()

    expect(headings($)).toHaveLength(5)
    expect(
      $('[data-testid="event-row"]').first().find('> [role="cell"]')
    ).toHaveLength(5)
  })

  // Every row carries the gutter, whether or not it opens: hanging the caret
  // inside the Event cell shifted every grouped row's type by its width, and
  // an operator scanning types down the page was reading a ragged edge.
  test('gives every row the disclosure gutter, empty unless it opens', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    const gutters = $(
      '[data-testid="event-row"], [data-testid="event-group-summary"]'
    )
      .toArray()
      .map((row) => $(row).find('> [role="cell"]').first())

    expect(gutters).toHaveLength(5)
    gutters.forEach((gutter) => {
      expect(gutter.attr('class')).toBeUndefined()
    })
    expect(
      $('[data-testid="event-group-summary"] > [role="cell"]')
        .first()
        .find('.do-caret')
    ).toHaveLength(1)
    expect($('[data-testid="event-row"] .do-caret')).toHaveLength(0)
  })

  // Not a `<table>`: consecutive identical rows have to fold into a group that
  // opens, and no `<tbody>` will hold a `<details>`. The roles put the table
  // back for assistive technology.
  test('builds the table as a grid carrying the table roles', async () => {
    const { $ } = await viewPage()

    const table = $('[data-testid="events-table"]')

    expect(table.is('table')).toBe(false)
    expect($('main table')).toHaveLength(0)
    expect(table.attr('role')).toBe('table')
    expect(table.attr('aria-label')).toBe('Events')
    expect($('[data-testid="events-head"]').attr('role')).toBe('row')
    expect($('[data-testid="event-row"]').first().attr('role')).toBe('row')
  })

  // One `grid-template-columns`, declared once in client/dev-ops.css, worn by
  // the header row and by every data row: a column that drifts between them is
  // the whole reason a grid table usually fails.
  test('dresses the header and every row in the one grid template', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-head"]').hasClass('do-events-row')).toBe(
      true
    )
    expect(
      $('[data-testid="event-row"]')
        .toArray()
        .every((row) => $(row).hasClass('do-events-row'))
    ).toBe(true)
  })

  // Twenty rows of ids all look alike, and a column of figures whose heading
  // has scrolled away is a column of unlabelled numbers.
  test('sticks the header to the top of the scroll box', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-head"]').hasClass('do-events-head')).toBe(
      true
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

  // A retry storm writes the same row eight times. Eight rows cost eight rows
  // of attention to learn one fact, so the run folds into a line that opens —
  // native disclosure, no script — and every member is still there.
  test('folds a run of identical rows into one group that opens', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const group = $('[data-testid="event-group"]')

    expect(group).toHaveLength(1)
    expect(group.is('details')).toBe(true)
    expect(group.attr('name')).toBe('events-group-1')
    expect(group.attr('role')).toBe('rowgroup')
    expect(group.find('[data-testid="event-row"]')).toHaveLength(3)
  })

  test('chips the group summary with how many rows it folded', async () => {
    givenEvents(storm(8))

    const { $ } = await viewPage()

    const chip = $('[data-testid="event-group-count"]')

    expect(chip.text()).toBe('×8')
    expect(chip.attr('class')).toBe('do-count-chip shrink-0')
    expect(chip.attr('title')).toBe('8 events in this group')
  })

  // That this line stands for eight rows is the second thing to know about
  // it, not the last: at the end of the cell the chip sat behind a truncated
  // reference, and an operator scanning the folds read past it every time.
  test('puts the count chip straight after the type, before the reference', async () => {
    givenEvents(storm(8))

    const { $ } = await viewPage()

    const parts = $('[data-testid="event-group-summary"] [role="cell"]')
      .eq(1)
      .find('> div > *')
      .toArray()
      .map((part) => $(part).attr('data-testid') ?? $(part).attr('class'))

    expect(parts[0]).toBe('event-type')
    expect(parts[1]).toBe('event-group-count')
    expect(
      $(
        '[data-testid="event-group-summary"] [data-testid="event-segregation-ref"]'
      )
    ).toHaveLength(1)
  })

  test('leaves a row with nothing beside it as a plain row', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-group"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]')).toHaveLength(1)
  })

  // Consecutive only. The endpoint's order is the operator's order, and
  // hoisting a row out of its place to sit with a match further down would
  // quietly rewrite the timeline the page exists to show.
  test('breaks a run where a row in the middle of it differs', async () => {
    givenEvents([
      ...storm(2),
      event({ id: 'odd', eventId: 'odd', status: 'FAILED' }),
      ...storm(2)
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-group"]')).toHaveLength(2)
    expect($('[data-testid="event-row"]')).toHaveLength(5)
    expect(
      $('[data-testid="event-group"]')
        .toArray()
        .map((group) => $(group).attr('name'))
    ).toEqual(['events-group-1', 'events-group-3'])
  })

  // The summary is the group's row: the same four columns, the shared status
  // said once, and the span the run covers rather than one member's instant.
  test('reads the group summary as one row of the same four columns', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const summary = $('[data-testid="event-group-summary"]')

    expect(summary.is('summary')).toBe(true)
    expect(summary.attr('role')).toBe('row')
    expect(summary.hasClass('do-events-row')).toBe(true)
    expect(summary.find('> [role="cell"]')).toHaveLength(5)
    expect(summary.find('[data-testid="do-status-badge"]')).toHaveLength(1)
    expect(summary.find('[data-testid="event-type"]').text()).toBe(
      'case.status.updated'
    )
    expect(summary.find('[data-testid="event-segregation-ref"]').text()).toBe(
      'GLD-9B2-BWS-grasslands'
    )
    expect(summary.find('[data-testid="event-route"]').text().trim()).toBe(
      'GAS → Caseworking'
    )
  })

  // The Created column is read down its right edge. A range on every summary
  // made it ragged for a fact an operator rarely needs at a glance, so the
  // summary says what a plain row says — the newest member's age, at the same
  // size — and the span opens the title.
  test('ages the group as a plain row does, with the span on the title', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const created = $('[data-testid="event-group-created-at"]')

    expect(created.text().trim()).toBe('3h 32m ago')
    expect(created.attr('class')).toBe(
      $('[data-testid="event-created-at"]').first().attr('class')
    )
    expect(created.attr('title')).toContain('3h 32m – 3h 40m ago')
    expect(created.attr('title')).toContain('Newest: 2026-06-16T06:48:00Z')
    expect(created.attr('title')).toContain('Oldest: 2026-06-16T06:40:00Z')
  })

  test('states the shared count and the newest failure on the summary', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const summary = $('[data-testid="event-group-summary"]')

    expect(summary.find('[data-testid="event-attempts"]').text()).toBe('5/5')
    expect(summary.find('[data-testid="event-last-failure"]').text()).toBe(
      '3h 32m ago'
    )
  })

  // It has to read as clickable standing still: a caret that turns, a pointer
  // cursor and the same hover tint the rows have.
  test('marks the summary as the control it is', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const summary = $('[data-testid="event-group-summary"]')

    expect(summary.hasClass('do-events-summary')).toBe(true)
    expect(summary.attr('class')).toContain('hover:bg-base-200/60')
    expect(summary.find('.do-caret')).toHaveLength(1)
    expect(summary.find('.do-caret').attr('aria-hidden')).toBe('true')
    expect(summary.attr('title')).toBe('Click to expand 3 events')
  })

  // Expanded, the members read as the rows they always were — indented by one
  // class, and by nothing else.
  test('indents the members of an open group and leaves them otherwise alone', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    const members = $('[data-testid="event-group"] [data-testid="event-row"]')

    expect(members).toHaveLength(3)
    members.toArray().forEach((member) => {
      expect($(member).attr('class')).toBe(
        `${rowClass} do-event-row-dead-letter do-events-member`
      )
    })
    expect(
      members
        .toArray()
        .map((member) => $(member).find('[data-testid="event-id"]').text())
    ).toEqual(['storm-0-…', 'storm-1-…', 'storm-2-…'])
  })

  test('folds a group without a line of script', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    expect($('script')).toHaveLength(1)
    expect($('main [onclick]')).toHaveLength(0)
    expect($('main button')).toHaveLength(0)
  })

  // What is on screen, counted, and nothing more: no total for the stream
  // exists, so every number is qualified by "on this page".
  test('rolls the page up in a strip at the top of the card', async () => {
    givenEvents(storm(20))

    const { $ } = await viewPage()

    const rollup = $('[data-testid="events-rollup"]')

    expect(rollup).toHaveLength(1)
    expect(
      $('[data-testid="events-card"] > *').first().attr('data-testid')
    ).toBe('events-rollup')
    expect(flatten(rollup.text())).toBe(
      '20 dead-lettered in 1 group · oldest 4h 48m ago Read from a secondary — may lag a few seconds'
    )
  })

  // One statement per fact. The strip says how the page divides, how it is
  // drawn and how far back it reaches; how many rows there are is the
  // footer's line, and the strip saying it too was the same number twice.
  test('counts the rows of the page once, in the footer', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup"]').text()).not.toContain('event')
    expect($('[data-testid="events-count"]')).toHaveLength(0)
    expect($('[data-testid="do-pager-count"]').text()).toBe('1 event')
  })

  // The strip, the chips and the footer are three views of one arithmetic, so
  // the strip says how its own counts are drawn as well as what they are.
  test('says how many groups those counts are drawn in', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    expect(flatten($('[data-testid="events-rollup-groups"]').text())).toBe(
      'in 1 group'
    )
  })

  // Nothing folded, nothing to say: `in 0 groups` is a fact about a page that
  // does not exist.
  test('mentions no groups on a page that folded nothing', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup-groups"]')).toHaveLength(0)
    expect($('[data-testid="events-rollup"]').text()).not.toContain('group')
  })

  // An empty bucket is not a fact worth a line of the strip: `0 completed`
  // reads as a problem on a page where nothing was meant to complete.
  test('names only the buckets that hold something', async () => {
    givenEvents([
      event({ id: '1', status: 'DEAD_LETTER' }),
      event({ id: '2', status: 'FAILED' }),
      event({ id: '3', status: 'PUBLISHED' })
    ])

    const { $ } = await viewPage()

    const buckets = $('[data-testid="events-rollup-bucket"]')
      .toArray()
      .map((bucket) => flatten($(bucket).text()))

    expect(buckets).toEqual(['1 dead-lettered', '1 retrying', '1 in flight'])
    expect($('[data-testid="events-rollup"]').text()).not.toContain('completed')
  })

  test('weights the figures in the strip and mutes the words', async () => {
    givenEvents([event({ status: 'DEAD_LETTER' })])

    const { $ } = await viewPage()

    const bucket = $('[data-testid="events-rollup-bucket"]').first()

    expect(bucket.attr('class')).toBe('text-base-content/60')
    expect(bucket.find('span').text()).toBe('1')

    // The dead-lettered count is the strip's subject and the one number in it
    // allowed any colour at all.
    expect(bucket.find('span').attr('class')).toBe('font-medium text-error/80')
  })

  // Every other count is one weight and one colour. Four differently-weighted
  // figures across a strip is four things asking to be read first.
  test('sets every count but the dead-lettered one at the same weight', async () => {
    givenEvents([...storm(2), event({ id: 'ok', status: 'COMPLETED' })])

    const { $ } = await viewPage()

    const figures = [
      $('[data-testid="events-rollup-bucket"]').last(),
      $('[data-testid="events-rollup-groups"]'),
      $('[data-testid="events-rollup-oldest"]')
    ]

    figures.forEach((figure) => {
      expect(figure.attr('class')).toBe('text-base-content/60')
      expect(figure.find('span').attr('class')).toBe(
        'font-medium text-base-content/80'
      )
    })
  })

  // The caveat is not one of the counts, so it is not spaced like one: a
  // hairline sets it apart from the arithmetic it qualifies, and the middots
  // stay punctuation between figures.
  test('separates the lag note from the counts with a hairline', async () => {
    const { $ } = await viewPage()

    const note = $('[data-testid="events-lag-note"]')

    expect(note.attr('class')).toContain('ml-auto')
    expect(note.attr('class')).toContain('border-l border-base-300')
    expect(note.attr('class')).toContain('pl-3')
  })

  test('names the oldest row on the page, with its absolute on the title', async () => {
    givenEvents([
      event({ id: '1', createdAt: '2026-06-16T10:00:00.000Z' }),
      event({ id: '2', createdAt: '2026-06-16T06:33:00.000Z', type: 'other' })
    ])

    const { $ } = await viewPage()

    const oldest = $('[data-testid="events-rollup-oldest"]')

    expect(flatten(oldest.text())).toBe('oldest 3h 47m ago')
    expect(oldest.find('span').attr('title')).toBe(
      '2026-06-16T06:33:00Z   ·   16 Jun 2026, 07:33:00 BST (Europe/London)'
    )
  })

  test('claims no total the endpoint never reported', async () => {
    givenEvents(storm(20), { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup"]').text()).not.toContain('of')
    expect($('main').text()).not.toContain('Total')
  })

  test('rolls up nothing on a page with no rows', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="events-rollup"]')).toHaveLength(0)
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
  test('leads the identity cell with the type, in semibold sans', async () => {
    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect(type.text()).toBe('case.status.updated')
    expect(type.attr('class')).not.toContain('font-mono')
    expect(type.attr('class')).toContain('text-[13px]')
    expect(type.attr('class')).toContain('font-semibold')
  })

  // The mono token is the machine half of the cell — the id an operator copies
  // and the reference they match — and it is the only part of the row still
  // set that way.
  test('keeps the id and the reference in mono after the sans type', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-id-line"]').attr('class')).toContain(
      'font-mono'
    )
    expect($('[data-testid="event-id-line"]').attr('class')).toContain(
      'text-[11px]'
    )
  })

  // The route is the one thing in the row a human reads as a sentence, so it
  // is the one thing that stays in the page's own face.
  test('keeps the human-facing route in sans beside the mono id', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-route"]').attr('class')).not.toContain(
      'font-mono'
    )
  })

  // The route sentence is never the thing that gets cut. Flexbox picked it
  // first, because it was the longest thing in the cell, and `GAS → Casewor…`
  // is a route nobody can read; the parenthetical gives instead.
  test('never truncates the route sentence, and truncates the suffix instead', async () => {
    const { $ } = await viewPage()

    const route = $('[data-testid="event-route"]')
    const detail = $('[data-testid="event-route-detail"]')

    expect(route.attr('class')).toContain('shrink-0')
    expect(route.attr('class')).not.toContain('truncate')
    expect(detail.attr('class')).toContain('min-w-0')
    expect(detail.attr('class')).toContain('truncate')
    expect(detail.attr('class')).not.toContain('shrink-0')
  })

  // The first group of the uuid: the cut lands on the hyphen the reader can
  // already see, rather than three characters into the group after it.
  test('shortens the event id and hangs the whole one off its title', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.text()).toBe('3f2c1a0e…')
    expect(id.attr('title')).toBe('3f2c1a0e-1111-2222-3333-444455556666')
  })

  // A space, a dot and a space: the tight middot ran the id straight into the
  // reference at 11px, and the dot itself sits a shade darker than the token
  // so it reads as a separator rather than as a character of either.
  test('sets the id and the segregation reference on one muted mono line', async () => {
    const { $ } = await viewPage()

    const line = $('[data-testid="event-id-line"]')

    expect(flatten(line.text())).toBe('3f2c1a0e… · GLD-9B2-BWS-grasslands')
    expect(line.attr('class')).toContain('font-mono')
    expect(line.attr('class')).toContain('text-[11px]')
    expect(line.attr('class')).toContain('text-base-content/45')
    expect(line.find('span.text-base-content\\/60').first().text()).toBe('·')
  })

  // One line, not two: the type and the id are read together, and a row that
  // stacks them is twice as tall for nothing.
  test('sets the whole identity cell on one line', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] [role="cell"]').eq(1)

    expect(cell.find('> div')).toHaveLength(1)
    expect(cell.find('> div').attr('class')).toContain('items-baseline')
    expect(cell.find('> div').attr('class')).not.toContain('flex-col')
    expect(cell.find('> div > *')).toHaveLength(3)
    expect(flatten(cell.text())).toBe(
      'case.status.updated 3f2c1a0e… · GLD-9B2-BWS-grasslands trace ↗'
    )
  })

  test('shows the segregation reference beside the id', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]').text()).toBe(
      'GLD-9B2-BWS-grasslands'
    )
  })

  // M2: the operator arrives holding a reference, and Ctrl+F is the only
  // search there is. It is on every row that has one, whatever the status.
  test('shows the segregation reference on a healthy row too', async () => {
    givenEvents([
      event({ status: 'COMPLETED', segregationRef: 'SFI-2A1-ARA-arable' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]').text()).toBe(
      'SFI-2A1-ARA-arable'
    )
  })

  test('omits the segregation reference line when the row carries none', async () => {
    givenEvents([event({ segregationRef: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  // R12 / product decision: the id is plain text. No link, no copy handler,
  // no primary colour to promise a click this page cannot honour.
  test('renders the event id as plain text, styled by the line it sits on', async () => {
    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.attr('class')).toBeUndefined()
    expect(id.attr('onclick')).toBeUndefined()
    expect(id.is('a, button')).toBe(false)
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
    expect(failure.attr('class')).toContain('text-base-content/45')
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
      .find('[role="cell"]')
      .toArray()
      .map((cell) => $(cell).html())
      .join('')

    expect(cells).not.toContain('text-error')
    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'do-status-dot-error'
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

    expect(classes).toEqual([`${rowClass} do-event-row-dead-letter`, rowClass])
  })

  // The fold has to say what it holds before it is opened: a group of dead
  // letters is a dead letter as far as the page is concerned.
  test('washes the summary of a group of dead letters too', async () => {
    givenEvents(storm(3))

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-group-summary"]').hasClass(
        'do-event-row-dead-letter'
      )
    ).toBe(true)
  })

  test('leaves the summary of a healthy group unwashed', async () => {
    givenEvents([
      event({ id: 'a', eventId: 'a', status: 'COMPLETED' }),
      event({ id: 'b', eventId: 'b', status: 'COMPLETED' })
    ])

    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('do-event-row-dead-letter')
  })

  // One line: the hop, then the queue it travelled on as a quiet parenthetical
  // after it. The second line was a line of mono under every row on the page
  // for a string most of them never needed read.
  test('reads an outbox row as the hop it is, on one line', async () => {
    const { $ } = await viewPage()

    const cell = $('[data-testid="event-row"] [role="cell"]').eq(3)

    expect($('[data-testid="event-route"]').text().trim()).toBe(
      'GAS → Caseworking'
    )
    expect(cell.find('> div')).toHaveLength(1)
    expect(cell.find('> div').attr('class')).not.toContain('flex-col')
    expect(flatten(cell.text())).toBe(
      'GAS → Caseworking (via update_status_fifo)'
    )
  })

  // The `cw__sns__` half of a topic names the service and the transport the
  // sentence in front of it has just named in full, and spending the whole cut
  // on that preamble threw away the tail that tells one queue from another.
  // The prefix goes; the raw topic stays on the title.
  test('drops the routing prefix from the topic and keeps the raw one on the title', async () => {
    const { $ } = await viewPage()

    const detail = $('[data-testid="event-route-detail"]')

    expect(detail.text()).toBe('(via update_status_fifo)')
    expect(detail.attr('title')).toBe('via cw__sns__update_status_fifo')
    expect(detail.attr('class')).toContain('font-mono')
    expect(detail.attr('class')).toContain('text-[11px]')
    expect(detail.attr('class')).toContain('text-base-content/50')
  })

  test('keeps the .fifo a queue name ends in', async () => {
    givenEvents([event({ target: 'cw__sqs__create_new_case_fifo.fifo' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-route-detail"]').text()).toBe(
      '(via create_new_case_fifo.fifo)'
    )
  })

  test('still cuts a topic too long for the column once stripped', async () => {
    givenEvents([
      event({ target: 'cw__sns__update_status_of_a_very_long_topic_name' })
    ])

    const { $ } = await viewPage()

    const detail = $('[data-testid="event-route-detail"]')

    expect(detail.text()).toBe('(via update_status_of_a_very_lo…)')
    expect(detail.attr('title')).toBe(
      'via cw__sns__update_status_of_a_very_long_topic_name'
    )
  })

  test('reads an inbox row by who produced it', async () => {
    givenEvents([
      event({
        service: 'caseworking',
        box: 'inbox',
        source: 'GAS',
        target: null
      })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-route"]').text().trim()).toBe(
      'GAS → Caseworking'
    )
    expect($('[data-testid="event-route-detail"]').text().trim()).toBe(
      '(cw inbox)'
    )
  })

  // The type beside it is the row's one bold anchor; the route says where the
  // message went, in regular weight. The arrow is quieter than the two names
  // it joins, but at 13px it still has to be legible: 60%, not 35%.
  test('sets the route in regular weight with a muted arrow', async () => {
    const { $ } = await viewPage()

    const route = $('[data-testid="event-route"]')

    expect(route.attr('class')).toContain('text-[12.5px]')
    expect(route.attr('class')).not.toContain('font-semibold')
    expect(route.attr('class')).not.toContain('font-bold')
    expect(route.find('span').text()).toBe('→')
    expect(route.find('span').attr('class')).toBe('text-base-content/60')
  })

  // One identifier grammar in the Event column: every other type on the page
  // is lowercase and dotted, and the shouted one read as urgent beside them.
  // The endpoint's own spelling is on the title.
  test('lowercases an audit label and keeps the raw one on the type', async () => {
    givenEvents([
      event({
        eventId: '665f1c2e9a1b2c3d4e5f6a7b',
        type: 'audit · CASE.CREATE_CASE',
        fullType: null,
        target: 'cw__sns__audit_fifo'
      })
    ])

    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect($('[data-testid="event-id"]').text()).toBe('665f1c2e…')
    expect(type.text()).toBe('audit · case.create_case')
    expect(type.attr('title')).toBe('audit · CASE.CREATE_CASE')
    expect($('[data-testid="event-route"]').text().trim()).toBe(
      'GAS → Caseworking'
    )
  })

  test('shouts nothing in the Event column', async () => {
    givenEvents([event({ type: 'audit · CASE.CREATE_CASE' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-type"]').text()).not.toMatch(/[A-Z]{2,}/)
  })

  // A type the page shows verbatim carries no title: a tooltip repeating the
  // text under the cursor is noise.
  test('hangs no title off a type it shows as it stands', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-type"]').attr('title')).toBeUndefined()
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
      'do-status-dot-error'
    )
    expect(badge.text().trim()).toBe('Dead letter')
    expect(badge.attr('title')).toBe('DEAD_LETTER')
    expect($('[data-testid="do-status-label"]').attr('class')).toContain(
      'font-medium'
    )
    expect(
      $('[data-testid="event-row"]').hasClass('do-event-row-dead-letter')
    ).toBe(true)
    expect(flatten($('[data-testid="event-status"]').text())).toBe(
      'Dead letter 5/5 · 4m ago'
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
    expect($('main').html()).not.toContain('do-event-row-completed')
  })

  test('leaves a row in neither state untreated', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-row"]').attr('class')).toBe(rowClass)
  })

  test('gives the table its own grid class', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-table"]').hasClass('do-events-grid')).toBe(
      true
    )
  })

  test('dots a published row quietly', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'do-status-dot-neutral'
    )
  })

  test('dots a processing row as in flight', async () => {
    givenEvents([event({ status: 'PROCESSING' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'do-status-dot-info'
    )
  })

  test('dots a retrying row amber and keeps the retry glyph', async () => {
    givenEvents([event({ status: 'FAILED' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'do-status-dot-warning'
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
      'do-status-dot do-status-dot-success'
    )
    expect($('[data-testid="do-status-label"]').attr('class')).toContain(
      'text-base-content/45'
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
      'do-status-dot do-status-dot-neutral',
      'do-status-dot do-status-dot-info',
      'do-status-dot do-status-dot-warning',
      'do-status-dot do-status-dot-error',
      'do-status-dot do-status-dot-success'
    ])
    expect($('main').html()).not.toContain('do-badge')
    expect($('main').html()).not.toContain('do-status-quiet')
  })

  test('dots a status it does not know quietly and still shows it', async () => {
    givenEvents([event({ status: 'QUARANTINED' })])

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="do-status-dot"]').attr('class')).toContain(
      'do-status-dot-neutral'
    )
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

    expect(flatten(detail.text())).toBe('5/5 · 4m ago')
    expect(detail.closest('[data-testid="event-status"]')).toHaveLength(1)
    expect(detail.attr('class')).toContain('text-[10.5px]')
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

    expect(flatten($('[data-testid="event-failure"]').text())).toBe('3/5 · —')
    expect($('[data-testid="event-failure"]').attr('title')).toContain(
      '3 of 5 attempts'
    )
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

  // The operator is mid-scan of a list of rows: a trace opens beside the page,
  // never over it.
  test('links a row with a trace id at the logs explorer, in a new tab', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    const link = $('[data-testid="event-trace-link"]')

    expect(link).toHaveLength(1)
    expect(link.attr('target')).toBe('_blank')
    expect(link.attr('rel')).toBe('noopener noreferrer')
    expect(link.attr('href')).toContain(logsBase)
    expect(link.attr('href')).toContain('/data-explorer/discover/#?')
    expect(link.attr('href')).not.toContain('savedSearch')
    expect(link.attr('href')).toContain(`%22${traceId}%22`)
  })

  // The link is a word on the id line rather than a line of its own: the
  // identity cell is two lines, and a trace id is not one of them.
  test('labels the trace link in a word and hangs the id off its title', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    const link = $('[data-testid="event-trace-link"]')

    expect(link.text()).toBe('trace ↗')
    expect(link.text()).not.toContain(traceId)
    expect(link.attr('title')).toBe(traceId)
    expect(link.attr('class')).toContain('shrink-0')
  })

  test('renders nothing at all, not even a dash, when the row has no trace id', async () => {
    givenLogsExplorer()
    givenEvents([event({ traceId: null })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
    expect($('[data-testid="event-row"]').text()).not.toContain('trace')
  })

  test('renders no trace link when no logs explorer is configured', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
  })

  test('links a Caseworking row at the Caseworking saved search', async () => {
    givenLogsExplorer()
    givenEvents([event({ service: 'caseworking', box: 'inbox' })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]').attr('href')).toContain(
      'container_name'
    )
    expect($('[data-testid="event-trace-link"]').attr('href')).not.toContain(
      'savedSearch'
    )
  })

  test('gives every row with a trace id its own link', async () => {
    givenLogsExplorer()
    givenEvents([
      event({ id: '1', traceId }),
      event({ id: '2', traceId: null }),
      event({ id: '3', traceId: 'cdp-request-id-1' })
    ])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"]')).toHaveLength(2)
  })

  test('a hostile trace id cannot break out of the href', async () => {
    givenLogsExplorer()
    givenEvents([event({ traceId: '" onmouseover="alert(1)' })])

    const { $ } = await viewPage()

    const link = $('[data-testid="event-trace-link"]')

    expect(link.attr('onmouseover')).toBeUndefined()
    expect(link.attr('href')).not.toContain('"')
    expect(link.attr('href')).toContain('%22%20onmouseover%3D%22alert(1)')
  })

  test('escapes a trace id containing markup', async () => {
    givenLogsExplorer()
    givenEvents([event({ traceId: `${xss}0123456789` })])

    const { $ } = await viewPage()

    expect($('[data-testid="event-trace-link"] script')).toHaveLength(0)
    expect($('[data-testid="event-trace-link"]').attr('title')).toBe(
      `${xss}0123456789`
    )
  })

  test('escapes a segregation reference containing markup', async () => {
    givenEvents([event({ segregationRef: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-segregation-ref')).toEqual(rendersAsText)
  })

  // The cell shows eight characters of it, so the whole hostile string only
  // ever reaches the title — which is exactly where an unescaped one would
  // break out of the attribute.
  test('escapes an event id containing markup, in the cell and in its title', async () => {
    givenEvents([event({ eventId: xss })])

    const { $ } = await viewPage()

    const id = $('[data-testid="event-id"]')

    expect(id.find('script')).toHaveLength(0)
    expect(id.text()).toBe('<script>…')
    expect(id.attr('title')).toBe(xss)
    expect($('script')).toHaveLength(1)
  })

  test('escapes a type containing markup', async () => {
    givenEvents([event({ type: xss })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-type')).toEqual(rendersAsText)
  })

  // A topic nothing recognises becomes the destination itself, so the hostile
  // string lands on the arrow and on the title — which is exactly where an
  // unescaped one would break out of the attribute.
  test('escapes a target containing markup, on the arrow and in its title', async () => {
    givenEvents([event({ box: 'outbox', source: null, target: xss })])

    const { $ } = await viewPage()

    const topic = $('[data-testid="event-route-topic"]')

    expect(topic).toHaveLength(1)
    expect(topic.find('script')).toHaveLength(0)
    expect(topic.text()).toBe(xss)
    expect(topic.attr('title')).toBe(xss)
    expect($('script')).toHaveLength(1)
  })

  // A route whose far end is a topic nobody named still has to be a sentence.
  // It used to end in an ellipsis; now the topic *is* the destination, in
  // mono because it is a machine string, and the `(via …)` suffix that would
  // repeat it word for word is not drawn at all. No row ends in `→ …`.
  test('puts an unrecognised topic on the arrow, and draws no suffix after it', async () => {
    givenEvents([
      event({
        box: 'outbox',
        source: null,
        target: 'grant_application_created_fifo'
      })
    ])

    const { $ } = await viewPage()

    const topic = $('[data-testid="event-route-topic"]')

    expect(flatten($('[data-testid="event-route"]').text())).toBe(
      'GAS → grant_application_created_fifo'
    )
    expect(topic.attr('class')).toContain('font-mono')
    expect(topic.attr('class')).toContain('text-[11.5px]')
    expect(topic.attr('title')).toBe('grant_application_created_fifo')
    expect($('[data-testid="event-route-detail"]')).toHaveLength(0)
    expect($('[data-testid="events-table"]').text()).not.toContain('→ …')
  })

  test('escapes a source containing markup', async () => {
    givenEvents([event({ box: 'inbox', source: xss, target: null })])

    const { $ } = await viewPage()

    expect(escapingOf($, 'event-route')).toEqual(rendersAsText)
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

  test('links Previous and Next to the cursors the endpoint issued', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-previous"]').attr('href')).toBe(
      '/dev-ops/events?cursor=START&direction=backward'
    )
    expect($('[data-testid="do-pager-next"]').attr('href')).toBe(
      '/dev-ops/events?cursor=END&direction=forward'
    )
  })

  test('keeps the status filter on both links', async () => {
    givenEvents([event()], {
      startCursor: 'START',
      endCursor: 'END',
      hasNextPage: true,
      hasPreviousPage: true
    })

    const { $ } = await viewPage('/dev-ops/events?status=DEAD_LETTER')

    expect($('[data-testid="do-pager-previous"]').attr('href')).toContain(
      'status=DEAD_LETTER'
    )
    expect($('[data-testid="do-pager-next"]').attr('href')).toContain(
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

    expect($('[data-testid="do-pager-previous"]').attr('href')).toContain(
      'service=gas'
    )
    expect($('[data-testid="do-pager-next"]').attr('href')).toContain(
      'service=gas'
    )
  })

  test('links no Previous on the first page, and holds its place', async () => {
    givenEvents([event()], { endCursor: 'END', hasNextPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-previous"]')).toHaveLength(0)
    expect($('[data-testid="do-pager-previous-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-next"]')).toHaveLength(1)
  })

  test('links no Next on the last page, and holds its place', async () => {
    givenEvents([event()], { startCursor: 'START', hasPreviousPage: true })

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-next"]')).toHaveLength(0)
    expect($('[data-testid="do-pager-next-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-previous"]')).toHaveLength(1)
  })

  test('omits the pager when there are no events', async () => {
    givenEvents([])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(0)
  })

  // The bar is the table's bottom edge as well as its control: on a page with
  // no page either side of it, the count is what stops the last row falling
  // off the card.
  test('counts the rows on the page beside the pager', async () => {
    givenEvents([event({ id: '1' }), event({ id: '2' }), event({ id: '3' })])

    const { $ } = await viewPage()

    expect(flatten($('[data-testid="do-pager-count"]').text())).toBe('3 events')
  })

  // One fact per line. How the rows are drawn — how many fold into a group —
  // is the rollup strip's sentence at the top of the card, and the footer
  // saying it too made two summaries of a page that has one.
  test('counts the rows alone in the footer, groups or no groups', async () => {
    givenEvents([...storm(3), event({ id: 'alone', eventId: 'alone' })])

    const { $ } = await viewPage()

    const count = $('[data-testid="do-pager-count"]')

    expect(flatten(count.text())).toBe('4 events')
    expect(count.text()).not.toContain('group')
    expect($('[data-testid="events-rollup-groups"]').text()).toContain(
      '1 group'
    )
  })

  test('counts the events alone on a page that folded nothing', async () => {
    givenEvents([event({ id: '1' }), event({ id: '2', type: 'other' })])

    const { $ } = await viewPage()

    expect($('[data-testid="do-pager-count"]').text()).toBe('2 events')
  })

  test('draws the bottom edge on a page with no links at all', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-pager"]')).toHaveLength(1)
    expect($('[data-testid="do-pager"] a')).toHaveLength(0)
    expect($('[data-testid="do-pager-count"]').text()).toBe('1 event')
    expect($('[data-testid="do-pager-previous-disabled"]')).toHaveLength(1)
    expect($('[data-testid="do-pager-next-disabled"]')).toHaveLength(1)
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
    expect($('[data-testid="do-pager-next"]')).toHaveLength(1)
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

  test('shows no card at all when nothing could be read', async () => {
    givenUnavailable()

    const { $ } = await viewPage()

    expect($('[data-testid="events-card"]')).toHaveLength(0)
    expect($('[data-testid="events-empty"]')).toHaveLength(0)
  })

  test('scrolls the table inside its own container', async () => {
    const { $ } = await viewPage()

    const scroller = $('[data-testid="events-scroller"]')

    expect(scroller.hasClass('overflow-auto')).toBe(true)
    expect(scroller.hasClass('do-events-scroller')).toBe(true)
    expect(scroller.find('[data-testid="events-table"]')).toHaveLength(1)
  })

  test('keeps the table wide enough for its four columns to scroll', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="events-scroller"] > div').attr('class')).toContain(
      'min-w-[64rem]'
    )
  })

  test('frames the table in a bordered card', async () => {
    const { $ } = await viewPage()

    const card = $('[data-testid="events-card"]')

    expect(card.attr('class')).toContain('rounded-box')
    expect(card.attr('class')).toContain('border-base-300')
    expect(card.attr('class')).toContain('bg-base-100')
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

    expect(
      $('[data-testid="events-scroller"] [data-testid="do-pager"]')
    ).toHaveLength(1)
    expect($('[data-testid="do-pager-previous"]').text()).toBe('← Previous')
    expect($('[data-testid="do-pager-next"]').text()).toBe('Next →')
  })

  // Previous, Next and the count are no use to an operator who has to scroll
  // twenty rows to reach them, so the bar rides the bottom of the scroll box.
  test('sticks the pager to the bottom of the scroll box', async () => {
    const { $ } = await viewPage()

    const pager = $('[data-testid="do-pager"]')

    expect(pager.hasClass('do-pager-sticky')).toBe(true)
    expect(pager.hasClass('bg-base-100')).toBe(true)
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

    const previous = $('[data-testid="do-pager-previous-disabled"]')

    expect(previous.is('span')).toBe(true)
    expect(previous.attr('href')).toBeUndefined()
    expect(previous.attr('class')).toContain('text-base-content/30')
    expect(previous.text()).toBe('← Previous')
  })

  // The filter bar is links. No form, no select, no button: the page has no
  // client-side JavaScript to run one, and no row action to offer.
  test('offers no actions, no form controls and no purge', async () => {
    const { $ } = await viewPage()

    expect($('main button')).toHaveLength(0)
    expect($('main select')).toHaveLength(0)
    expect($('main form')).toHaveLength(0)
    expect($('main input')).toHaveLength(0)
    expect($('main [role="tablist"]')).toHaveLength(0)
  })

  // Product decision: no client-side JavaScript on this page at all. The
  // layout's own module script is the only one a correct page carries.
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

  // A paragraph floating under the card was a caption for nothing. The note is
  // a fact about what the card is showing, so it sits in the card's own
  // footer, opposite the count, and nothing floats below the card at all.
  test('notes that the data may lag inside the rollup strip, not the footer', async () => {
    const { $ } = await viewPage()

    const note = $('[data-testid="events-lag-note"]')

    expect(note.text().trim()).toBe(
      'Read from a secondary — may lag a few seconds'
    )
    expect(note.attr('title')).toBe(
      'Data may be a few seconds behind (read from a secondary).'
    )
    expect(note.attr('class')).toContain('text-[10px]')
    expect(note.attr('class')).toContain('text-base-content/40')
    expect(note.attr('class')).toContain('ml-auto')
    expect(note.closest('[data-testid="events-rollup"]')).toHaveLength(1)
    expect($('[data-testid="events-footnote"]')).toHaveLength(0)
    expect($('[data-testid="events-card"]').next()).toHaveLength(0)
  })

  // The navbar named the deployable, in kebab case. It names the product now,
  // with the app it is showing as a quiet suffix; the repo name still titles
  // the tab, which is the one place it earns its keep.
  test('brands the header with the product and the app', async () => {
    const { $ } = await viewPage()

    const brand = $('[data-testid="do-brand"]')

    expect(brand.text().replace(/\s+/g, ' ').trim()).toBe(
      'Grants Platform · Dev Ops'
    )
    expect(brand.attr('class')).toContain('font-semibold')
    expect(brand.attr('href')).toBe('/dev-ops')
    expect($('[data-testid="do-brand-suffix"]').attr('class')).toContain(
      'text-base-content/50'
    )
    expect(brand.text()).not.toContain('fg-grants-platform-admin')
  })

  test('sets Sign out as a small quiet button, beside the theme toggle', async () => {
    const { $ } = await viewPage()

    const signOut = $('header a[href="/auth/logout"]')

    expect(signOut.attr('class')).toBe('btn btn-ghost btn-sm')
    expect($('header do-theme-toggle')).toHaveLength(1)
  })
})
