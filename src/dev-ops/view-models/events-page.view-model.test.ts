import { config } from '../../common/config.ts'
import type {
  Event,
  EventBox,
  EventBreakdownGroup,
  EventCounts,
  EventFacets,
  EventService,
  EventsPagination,
  EventsQuery,
  EventsResult,
  SourceError
} from '../use-cases/get-events.use-case.ts'
import type { EventsPageQuery, FilterChip } from './events-page.view-model.ts'
import { toEventsPage } from './events-page.view-model.ts'

vi.mock(import('../../common/config.ts'))

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

/**
 * The feature is off until a base url is configured, so every trace assertion
 * turns it on for itself. `clearMocks` wipes the write between tests.
 */
const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

/**
 * The clock the page is rendered against. Every relative time below is stated
 * as an offset from this instant, so the assertions read as the operator reads
 * the column rather than as arithmetic.
 */
const now = new Date('2026-06-16T10:20:00.000Z')

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
 * always present, zero included.
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

const result = (
  events: Event[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
): EventsResult => ({
  page: { events, pagination: pagination(overrides), sourceErrors },
  facets: facets(),
  breakdown: null,
  unavailable: false
})

const model = (
  events: Event[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = [],
  query: EventsQuery = {}
) => toEventsPage(result(events, overrides, sourceErrors), query, now)

/** The same page, asked with a query, when the query is the point. */
const modelFor = (query: EventsQuery, events: Event[] = [event()]) =>
  toEventsPage(result(events), query, now)

const rowFor = (overrides: Partial<Event> = {}) =>
  model([event(overrides)]).rows[0]

/**
 * The same page with facets of its own — or with none at all, which is what a
 * failed counts read looks like from here.
 */
const modelWith = (
  read: EventFacets | null,
  query: EventsQuery = {},
  events: Event[] = [event()]
) =>
  toEventsPage(
    {
      page: { events, pagination: pagination(), sourceErrors: [] },
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

/**
 * A retry storm as the endpoint returns one: the same message, reference,
 * status and queue, minutes apart, one row per attempt.
 */
const storm = (minutesAgo: number[], overrides: Partial<Event> = {}) =>
  minutesAgo.map((minutes, index) =>
    event({
      id: `storm-${index}`,
      eventId: `storm-${index}`,
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
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

  // The relative time is unquotable and, on a tab left open, a lie. The title
  // carries the instant a developer greps for and the wall-clock time the
  // operator is thinking in, in that order.
  test('carries the ISO instant and the London time in the created title', () => {
    expect(
      rowFor({ createdAt: '2026-06-16T10:00:00.000Z' }).createdAtTitle
    ).toBe(
      '2026-06-16T10:00:00Z   ·   16 Jun 2026, 11:00:00 BST (Europe/London)'
    )
  })

  test('states Greenwich Mean Time on a winter row', () => {
    expect(
      rowFor({ createdAt: '2026-01-16T10:00:00.000Z' }).createdAtTitle
    ).toBe(
      '2026-01-16T10:00:00Z   ·   16 Jan 2026, 10:00:00 GMT (Europe/London)'
    )
  })

  // Attempts and Last failure are one column now, so they are one tooltip:
  // the count in words above both spellings of the instant, because the cell
  // itself says `5/5 · 4m ago` and neither half of that is quotable.
  test('carries the count in words and both formats in the failure title', () => {
    expect(
      rowFor({
        attempts: 5,
        lastFailureAt: '2026-06-16T10:16:05.000Z'
      }).failureTitle
    ).toBe(
      '5 of 5 attempts\n2026-06-16T10:16:05Z   ·   16 Jun 2026, 11:16:05 BST (Europe/London)'
    )
  })

  // A row that has been retried but recorded no failure still has a count to
  // report, and the title says only what it knows.
  test('states the count alone when nothing ever failed', () => {
    expect(rowFor({ attempts: 3, lastFailureAt: null }).failureTitle).toBe(
      '3 of 5 attempts\nNo failure recorded'
    )
  })

  test('counts the last failure from the same clock', () => {
    expect(
      rowFor({ lastFailureAt: '2026-06-16T10:16:05.000Z' }).lastFailureAt
    ).toBe('4m ago')
  })

  test('shows a dash and says so in the title when a row has never failed', () => {
    const row = rowFor({ lastFailureAt: null })

    expect(row.lastFailureAt).toBe('-')
    expect(row.failureTitle).toBe('No failure recorded')
  })

  test('shows a dash rather than throwing on an unparseable timestamp', () => {
    const row = rowFor({ createdAt: 'nope' })

    expect(row.createdAt).toBe('-')
    expect(row.createdAtTitle).toBe('')
  })

  test('shows a dash rather than throwing on an unparseable failure time', () => {
    expect(rowFor({ lastFailureAt: 'nope' }).lastFailureAt).toBe('-')
  })

  test('leaves a published row quiet', () => {
    expect(rowFor({ status: 'PUBLISHED' })).toMatchObject({
      statusLabel: 'Published',
      statusRole: 'neutral',
      statusRetrying: false
    })
  })

  test('marks a processing row as in flight', () => {
    expect(rowFor({ status: 'PROCESSING' })).toMatchObject({
      statusLabel: 'Processing',
      statusRole: 'info',
      statusRetrying: false
    })
  })

  test('marks a failed row as retrying', () => {
    expect(rowFor({ status: 'FAILED' })).toMatchObject({
      statusLabel: 'Failed',
      statusRole: 'warning',
      statusRetrying: true
    })
  })

  test('marks a resubmitted row as retrying', () => {
    expect(rowFor({ status: 'RESUBMITTED' })).toMatchObject({
      statusLabel: 'Resubmitted',
      statusRole: 'warning',
      statusRetrying: true
    })
  })

  test('marks a completed row as done', () => {
    expect(rowFor({ status: 'COMPLETED' })).toMatchObject({
      statusLabel: 'Completed',
      statusRole: 'success',
      statusRetrying: false
    })
  })

  test('marks a dead letter row as failed', () => {
    expect(rowFor({ status: 'DEAD_LETTER' })).toMatchObject({
      statusLabel: 'Dead letter',
      statusRole: 'error',
      statusRetrying: false
    })
  })

  test('falls back to a quiet badge for a status it does not know', () => {
    expect(rowFor({ status: 'QUARANTINED' })).toMatchObject({
      statusRole: 'neutral',
      statusRetrying: false
    })
  })

  // The raw value is what `?status=` and a log query are written in, so it
  // travels beside the label rather than being replaced by it.
  test('keeps the raw status beside the label a human reads', () => {
    expect(rowFor({ status: 'DEAD_LETTER' })).toMatchObject({
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter'
    })
  })

  test('labels a status it does not know as the endpoint spelled it', () => {
    expect(rowFor({ status: 'QUARANTINED' })).toMatchObject({
      status: 'QUARANTINED',
      statusLabel: 'QUARANTINED'
    })
  })

  // One state is worth colouring a whole row for, and it is the one an
  // operator opened the page to find. Every other status recedes — the
  // commonest of them, Completed, as far as plain grey text — so the tint the
  // template hangs off this flag is the only saturated thing on a calm page.
  test('marks a dead letter row, and no other', () => {
    expect(rowFor({ status: 'DEAD_LETTER' }).isDeadLetter).toBe(true)
    expect(rowFor({ status: 'COMPLETED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'FAILED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'PUBLISHED' }).isDeadLetter).toBe(false)
    expect(rowFor({ status: 'COMPLETED' })).not.toHaveProperty('isCompleted')
  })

  // The Queue cell's two lines are `toQueue`'s, tested in event-formats; what
  // the *list* adds is the link under the hop label. It is a filter chip in
  // all but shape — the same page narrowed to this row's service, keeping
  // every other filter — so an operator who has found one bad hop can see the
  // rest of it without going back to the toolbar.
  test('draws the hop as the source cell over where the message went', () => {
    expect(rowFor()).toMatchObject({
      hop: 'GAS · Outbox',
      queue: 'to Caseworking',
      queueValue: 'gas__sns__update_case_status_fifo'
    })
  })

  test('links the hop to this page filtered to its service', () => {
    expect(rowFor()).toMatchObject({
      hopHref: '/dev-ops/events?service=gas',
      hopTitle: 'Filter to GAS'
    })
    expect(rowFor({ service: 'caseworking' })).toMatchObject({
      hopHref: '/dev-ops/events?service=caseworking',
      hopTitle: 'Filter to Caseworking'
    })
  })

  // Every other filter travels, and the cursor does not: a keyset position
  // taken under one service means nothing under another.
  test('carries the other filters onto the hop link and drops the cursor', () => {
    const [row] = model([event()], {}, [], {
      status: 'DEAD_LETTER',
      q: 'GLD-9B2',
      cursor: 'WHERE-I-WAS'
    }).rows

    expect(row.hopHref).toBe(
      '/dev-ops/events?status=DEAD_LETTER&service=gas&q=GLD-9B2'
    )
  })

  // A service the toolbar has no chip for is a `?service=` the endpoint has
  // never heard of, and a link to it can only ever answer with an empty page.
  test('leaves a hop it cannot filter to as a plain label', () => {
    expect(
      rowFor({ service: 'reporting' as unknown as EventService })
    ).toMatchObject({
      hop: 'reporting · Outbox',
      hopHref: null,
      hopTitle: null
    })
  })

  test('counts attempts against the maximum', () => {
    const row = rowFor({ attempts: 3, maxAttempts: 5 })

    expect(row.attempts).toBe('3/5')
    expect(row.attemptsAtMax).toBe(false)
  })

  test('marks a row at its maximum attempts', () => {
    const row = rowFor({ attempts: 5, maxAttempts: 5 })

    expect(row.attempts).toBe('5/5')
    expect(row.attemptsAtMax).toBe(true)
  })

  test('marks a row past its maximum attempts', () => {
    const row = rowFor({ attempts: 6, maxAttempts: 5 })

    expect(row.attempts).toBe('6/5')
    expect(row.attemptsAtMax).toBe(true)
  })

  test('counts against the maximum the row carries', () => {
    const row = rowFor({
      service: 'caseworking',
      attempts: 2,
      maxAttempts: 2
    })

    expect(row.attempts).toBe('2/2')
    expect(row.attemptsAtMax).toBe(true)
  })

  test('shows a dash if an attempt count is ever missing', () => {
    const row = rowFor({ attempts: undefined as unknown as number })

    expect(row.attempts).toBe('-')
    expect(row.attemptsAtMax).toBe(false)
  })

  test('shows a question mark when the endpoint reported no maximum', () => {
    const row = rowFor({ attempts: 3, maxAttempts: null })

    expect(row.attempts).toBe('3/?')
    expect(row.attemptsAtMax).toBe(false)
  })

  // Attempts is its own column again, and it is empty on a row with nothing to
  // report: `1/5` on a row that has never failed is a repetition of "nothing
  // has gone wrong", twenty times down a page.
  test('reports nothing in the failure column for an untouched row', () => {
    const row = rowFor({ attempts: 1, lastFailureAt: null })

    expect(row.showAttempts).toBe(false)
    expect(row.hasFailure).toBe(false)
  })

  test('leads with the attempt count once a row has been retried', () => {
    const row = rowFor({ attempts: 3, lastFailureAt: null })

    expect(row.showAttempts).toBe(true)
    expect(row.hasFailure).toBe(false)
    expect(row.attempts).toBe('3/5')
  })

  test('leads with the count on a first attempt that did fail', () => {
    const row = rowFor({
      attempts: 1,
      lastFailureAt: '2026-06-16T10:16:05.000Z'
    })

    expect(row.showAttempts).toBe(true)
    expect(row.hasFailure).toBe(true)
    expect(row.lastFailureAt).toBe('4m ago')
  })

  test('reports no failure when the one the endpoint sent is unreadable', () => {
    expect(rowFor({ lastFailureAt: 'nope' }).hasFailure).toBe(false)
  })

  test('says nothing at all when the attempt count is missing too', () => {
    const row = rowFor({ attempts: undefined as unknown as number })

    expect(row.showAttempts).toBe(false)
    expect(row.hasFailure).toBe(false)
  })

  // `Failed` says a message did not get through and never says why. One line
  // of the actual error is the difference between triaging on this page and
  // leaving it for the logs.
  test('reports why the last attempt failed', () => {
    const row = rowFor({
      lastFailureAt: '2026-06-16T10:16:05.000Z',
      lastError: {
        name: 'MongoServerError',
        message: 'connect ETIMEDOUT 10.0.3.14:443',
        at: '2026-06-16T10:16:05.000Z'
      }
    })

    expect(row.errorMessage).toBe('connect ETIMEDOUT 10.0.3.14:443')
    expect(row.errorTitle).toBe(
      'MongoServerError: connect ETIMEDOUT 10.0.3.14:443\n2026-06-16T10:16:05Z   ·   16 Jun 2026, 11:16:05 BST (Europe/London)'
    )
  })

  // Sixty-four characters is what the status column holds without making one
  // row three lines tall. The whole message is on the title.
  test('cuts a reason too long for the column, whole on the title', () => {
    const message =
      'E11000 duplicate key error collection: gas.events index: eventId_1 dup key'

    const row = rowFor({
      lastError: { name: 'MongoServerError', message, at: null }
    })

    expect(row.errorMessage).toBe(
      'E11000 duplicate key error collection: gas.events index: eventId…'
    )
    expect(row.errorTitle).toBe(`MongoServerError: ${message}`)
  })

  test('leaves a reason the column can hold uncut', () => {
    const row = rowFor({
      lastError: { name: 'Error', message: 'nope', at: null }
    })

    expect(row.errorMessage).toBe('nope')
  })

  test('reports no reason for a row that failed without one', () => {
    const row = rowFor({ lastFailureAt: '2026-06-16T10:16:05.000Z' })

    expect(row.errorMessage).toBeNull()
    expect(row.errorTitle).toBeNull()
  })

  test('ignores an instant it cannot read in a failure reason', () => {
    const row = rowFor({
      lastError: { name: 'Error', message: 'nope', at: 'never' }
    })

    expect(row.errorTitle).toBe('Error: nope')
  })

  // The id is drawn in full: a CloudEvent id is a ~36-character uuid and a
  // Mongo fallback id 24 hex characters, and either fits the Event track.
  test('carries the whole event id, unshortened', () => {
    const row = rowFor({ eventId: '3f2c1a0e-1111-2222-3333-444455556666' })

    expect(row.eventId).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(row).not.toHaveProperty('eventIdShort')
  })

  // The id is the row's identity and is always there; the type is the second
  // half of it and simply is not, on an audit record. It comes through null,
  // and the template draws no line for it — nothing is synthesised here and
  // nothing stands in for it.
  test('carries a null type through, with the id still naming the row', () => {
    const row = rowFor({
      eventId: '665f1c2e9a1b2c3d4e5f6a7b',
      type: null,
      fullType: null
    })

    expect(row.eventId).toBe('665f1c2e9a1b2c3d4e5f6a7b')
    expect(row.type).toBeNull()
    expect(row).not.toHaveProperty('typeTitle')
  })

  test('shows the type the endpoint spells, exactly as it stands', () => {
    expect(rowFor().type).toBe('case.status.updated')
  })

  // The reference is off the table entirely: it lives on the row's own page,
  // and the search box still takes one. A row is named by its id alone here.
  test('puts no segregation reference on a row', () => {
    const row = rowFor({ segregationRef: 'GLD-9B2-BWS-grasslands' })

    expect(row).not.toHaveProperty('segregationRef')
    expect(row).not.toHaveProperty('segregationRefHref')
    expect(row).not.toHaveProperty('segregationRefTitle')
  })

  // Rows the page used to fold into a run are each their own row now: the
  // consecutive-run rollups are gone, and identical rows stay identical rows.
  test('renders every row of a retry storm as its own row', () => {
    const page = model(storm([32, 34, 36, 38]))

    expect(page.rows).toHaveLength(4)
    expect(page).not.toHaveProperty('groups')
  })

  test('renders a run of null-typed rows as separate rows too', () => {
    const page = model(storm([32, 34], { type: null, fullType: null }))

    expect(page.rows).toHaveLength(2)
    expect(page.rows.every((row) => row.type === null)).toBe(true)
  })

  // Sentence case, like the badges: one vocabulary for the two places the
  // same six words are written. The raw enum stays on the href. The list ends
  // at Dead letter — where a message that could not be delivered ends.
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

  // A keyset position taken under one filter means nothing under another, so
  // changing a filter starts the list again.
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

  // The TYPE control is gone with the filter it drove: two segmented controls
  // on the toolbar, and no `kind` on any link the page draws.
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

  // A GET form submits its own fields and nothing else, so the filters have to
  // travel as hidden ones or a search quietly widens the page to All.
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
      { service: 'caseworking', box: 'inbox', message: 'not configured' },
      { service: 'caseworking', box: 'outbox', message: 'not configured' }
    ])

    expect(unavailableSources).toBe('CW · Inbox, CW · Outbox')
  })

  test('names a GAS source when one GAS read failed', () => {
    const { unavailableSources } = model([event()], {}, [
      { service: 'gas', box: 'outbox', message: 'read error' }
    ])

    expect(unavailableSources).toBe('GAS · Outbox')
  })

  test('names sources from both services when each lost one', () => {
    const { unavailableSources } = model([event()], {}, [
      { service: 'gas', box: 'inbox', message: 'read error' },
      { service: 'caseworking', box: 'outbox', message: 'timeout' }
    ])

    expect(unavailableSources).toBe('GAS · Inbox, CW · Outbox')
  })

  test('names an unavailable source it has no label for as the endpoint named it', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: 'reporting' as unknown as EventService,
        box: 'deadletter' as unknown as EventBox,
        message: 'timeout'
      }
    ])

    expect(unavailableSources).toBe('reporting · deadletter')
  })

  // The banner is built from the endpoint's own service/box strings, so a
  // hostile one reaches a template. Escaping is nunjucks' job; this pins that
  // the model hands the value over raw rather than pre-rendering markup.
  test('leaves markup in an unavailable source name for the template to escape', () => {
    const { unavailableSources } = model([event()], {}, [
      {
        service: '<script>alert(1)</script>' as unknown as EventService,
        box: 'inbox',
        message: 'timeout'
      }
    ])

    expect(unavailableSources).toBe('<script>alert(1)</script> · Inbox')
  })

  test('reports the page unavailable when it could not be read', () => {
    const { unavailable, rows } = toEventsPage(
      {
        page: {
          events: [],
          pagination: pagination(),
          sourceErrors: []
        },
        facets: null,
        breakdown: null,
        unavailable: true
      },
      {}
    )

    expect(unavailable).toBe(true)
    expect(rows).toHaveLength(0)
  })

  // The list rows carry no trace link any more: the identity cell is the id,
  // the reference and the type, and the way out into the logs is on the row's
  // own page. Nothing on a list row builds a Discover href.
  test('puts no trace link and no trace id on a row', () => {
    givenLogsExplorer()

    const row = rowFor()

    expect(row).not.toHaveProperty('traceHref')
    expect(row).not.toHaveProperty('traceId')
  })

  // The page counts nothing about itself any more. `20 events` under a page
  // of twenty was a fact about a window, and the toolbar above it now carries
  // the facts about the stream; the two kinds of arithmetic sitting inches
  // apart invited the smaller one to be read as the larger.
  test('reports no count of its own rows', () => {
    const page = model([...storm([30, 32, 34]), event({ id: 'alone' })])

    expect(page).not.toHaveProperty('eventCount')
    expect(page.rows).toHaveLength(4)
  })

  // Each status segment says how many events *selecting it* would find, which
  // is what makes the control worth reading rather than a row of words an
  // operator has to try one at a time.
  //
  // `All` carries no figure. It used to wear the sum of the six beside it —
  // the page's headline number, inside one segment of one filter, and a facet
  // at that, so selecting a status left it unmoved. It is a plain label now
  // and the total is stated over the table.
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

  // The SERVICE segments are plain labels. Two of them, named after the thing
  // they select, and a figure on each said nothing an operator was reading
  // them for; the STATUS row beside them is where the arithmetic belongs.
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

  // A segment that vanished when it emptied could not be told from one the
  // page had forgotten to draw, and `Failed 0` is the most reassuring thing
  // on this page. It stays, dimmed, and it stays a link.
  test('marks an empty segment as empty, and still links it', () => {
    const chips = statusChips()

    expect(labelled(chips, 'Failed')).toMatchObject({
      countLabel: '0',
      zero: true,
      href: '/dev-ops/events?status=FAILED'
    })
    expect(labelled(chips, 'Dead letter')).toMatchObject({ zero: false })
  })

  // The dead letters are the page's subject and the one figure in the toolbar
  // allowed a colour at all — until there are none, which is not an alarm.
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

  // A summary that could not be read has not made the filters below it an
  // error. The segments go back to being the words they always were.
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

  // Seven states named in one word each is a vocabulary an operator is
  // expected to already have; the gloss is on the segment that names each one.
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

  // The window is said once, on the TIME button, and nowhere else: the strip
  // below carried a second copy of it back when the range had no control of
  // its own showing its value.
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

  // How long a message actually took, on the rows that finished. `Completed`
  // said that one got through and never said how quickly.
  test.each([
    ['2026-06-16T10:00:00.430Z', '430ms'],
    ['2026-06-16T10:00:01.200Z', '1.2s'],
    ['2026-06-16T10:00:01.000Z', '1.0s'],
    ['2026-06-16T10:00:59.960Z', '1m 0s'],
    ['2026-06-16T10:03:12.000Z', '3m 12s'],
    // Past an hour it reads in hours. `334m 0s` is a number to be divided
    // rather than a duration to be recognised, and the same formatter now
    // spells the gaps between delivery attempts on the single-event page.
    ['2026-06-16T15:34:00.000Z', '5h 34m'],
    ['2026-06-17T10:00:00.000Z', '24h 0m']
  ])('reports a completion at %s as %s', (completedAt, latency) => {
    expect(rowFor({ status: 'COMPLETED', completedAt }).latency).toBe(latency)
  })

  test('reports no latency for a row that has not completed', () => {
    expect(rowFor({ completedAt: null }).latency).toBeNull()
  })

  test('reports no latency when either instant is unreadable', () => {
    expect(
      rowFor({ createdAt: 'never', completedAt: '2026-06-16T10:00:01.000Z' })
        .latency
    ).toBeNull()
  })

  // One keyset window is almost always one day, so a row from today draws the
  // time alone. "Almost always" is where a bare clock lied: the page filtered
  // to Dead letter is exactly the page whose rows are days old, and `08:18:01`
  // on one of them reads as this morning to anybody scanning.
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

  // The column carries no copy value any more, and so no third spelling of
  // the instant: two are on the line and the whole of it is a click away on
  // the row's own page, which is where an operator goes to copy anything.
  test('carries no copy value for the clock', () => {
    expect(
      rowFor({ createdAt: '2026-06-14T08:18:01.250Z' })
    ).not.toHaveProperty('createdAtValue')
  })

  test('draws no clock for an instant it cannot read', () => {
    expect(rowFor({ createdAt: 'never' }).createdAtClock).toBe('')
  })

  // The line under the status is relative and stays relative: it is read to
  // see whether a row is still moving, not to be pasted anywhere. Both
  // absolute spellings are on its title, which is where an unquotable figure
  // has to keep them.
  test('keeps the status sub-line relative, with the instant on its title', () => {
    const row = rowFor({
      status: 'FAILED',
      attempts: 5,
      maxAttempts: 5,
      lastFailureAt: '2026-06-16T09:39:00.000Z'
    })

    expect(row.lastFailureAt).toBe('41m ago')
    expect(row.failureTitle).toContain('2026-06-16T09:39:00Z')
    expect(row.failureTitle).toContain('Europe/London')
  })

  // The page has no opinion about how often it is looked at. `?live=30` used
  // to ride every filter link and every hidden field so an automatic reload
  // survived a filter change; with the toggle gone the parameter is gone too,
  // and a `live` typed onto the url by hand is simply not one of the page's.
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
        events: [event({ status: 'DEAD_LETTER' })],
        pagination: pagination(),
        sourceErrors: []
      },
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
    expect(panel?.summary).toBe('Top failures (1 group)')
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

    expect(panel?.summary).toBe('Top failures (2 groups)')
    expect(panel?.count).toBe(2)
  })

  // Nothing to summarise is silence, not an empty panel.
  test('is absent when the breakdown reported no groups', () => {
    expect(withBreakdown({ status: 'DEAD_LETTER' }, []).topFailures).toBeNull()
  })

  test('is absent when the breakdown could not be read at all', () => {
    expect(modelFor({ status: 'DEAD_LETTER' }).topFailures).toBeNull()
  })

  // An unfiltered page with nothing dead behind it has nothing to announce.
  test('is absent on an unfiltered page with no dead letters', () => {
    expect(
      withBreakdown({}, [group()], { DEAD_LETTER: 0 }).topFailures
    ).toBeNull()
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
    expect(row.hasError).toBe(true)
  })

  // Ninety characters is enough to tell one duplicate-key index from another,
  // which is the distinction the panel exists to draw. The whole message stays
  // on the title, and travels whole on the link.
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

  // A keyset position taken under one filter means nothing under another.
  test('drops the cursor from the link', () => {
    const [row] =
      withBreakdown({ cursor: 'END', direction: 'forward' }).topFailures
        ?.groups ?? []

    expect(row.href).not.toContain('cursor')
    expect(row.href).not.toContain('direction')
  })

  // The groups that recorded no message are counted like any other and cannot
  // be isolated like any other: `?error=` matches a message, and there is none.
  test('names a group with no error, and links it without one', () => {
    const panel = withBreakdown({ status: 'DEAD_LETTER' }, [
      group({ error: null, count: 12 })
    ]).topFailures
    const [row] = panel?.groups ?? []

    expect(row.message).toBe('(no error recorded)')
    expect(row.messageTitle).toBe('(no error recorded)')
    expect(row.hasError).toBe(false)
    expect(row.href).toBe('/dev-ops/events?status=DEAD_LETTER')
    expect(panel?.hasUnattributed).toBe(true)
  })

  test('says nothing about unattributed groups when every group has an error', () => {
    expect(withBreakdown().topFailures?.hasUnattributed).toBe(false)
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

// The PARKED state is gone from the vocabulary: no chip offers it, and no row
// can be in it.
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

// The endpoint reports a never-attempted row as zero rather than one. It is a
// count worth nothing on its own, so the line under the status stays off.
describe('a row that has never been attempted', () => {
  test('reads its count as zero and says nothing under the status', () => {
    const row = rowFor({ attempts: 0, lastFailureAt: null, lastError: null })

    expect(row.attempts).toBe('0/5')
    expect(row.showAttempts).toBe(false)
    expect(row.attemptsAtMax).toBe(false)
  })
})
