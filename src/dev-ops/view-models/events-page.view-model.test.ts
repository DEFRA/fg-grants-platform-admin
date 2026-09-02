import { config } from '../../common/config.ts'
import type {
  Event,
  EventBox,
  EventService,
  EventsPagination,
  EventsQuery,
  EventsResult,
  SourceError
} from '../use-cases/get-events.use-case.ts'
import type { FilterChip } from './events-page.view-model.ts'
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

const result = (
  events: Event[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = []
): EventsResult => ({
  page: { events, pagination: pagination(overrides), sourceErrors },
  unavailable: false
})

const model = (
  events: Event[],
  overrides: Partial<EventsPagination> = {},
  sourceErrors: SourceError[] = [],
  query: EventsQuery = {}
) => toEventsPage(result(events, overrides, sourceErrors), query, now)

const rowFor = (overrides: Partial<Event> = {}) =>
  model([event(overrides)]).rows[0]

const groupsOf = (events: Event[]) => model(events).groups

const rollupOf = (events: Event[]) => model(events).rollup

/** The shape a grouping assertion reads in: how many groups, and how big. */
const shapeOf = (events: Event[]) =>
  groupsOf(events).map(({ count, grouped }) => ({ count, grouped }))

/**
 * A retry storm as the endpoint returns one: the same message, reference,
 * status and route, minutes apart, one row per attempt.
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

/**
 * The Route cell's two names, rejoined by the arrow the template puts back
 * between them, so each assertion below reads as the cell reads.
 */
const routeOf = (overrides: Partial<Event> = {}) => {
  const { routeFrom, routeTo, routeDetail } = rowFor(overrides)

  return { headline: `${routeFrom} → ${routeTo}`, detail: routeDetail }
}

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

  test('states a group range in words in the same title', () => {
    const [group] = groupsOf([
      ...storm([32], {
        attempts: 5,
        lastFailureAt: '2026-06-16T10:10:00.000Z'
      }),
      ...storm([34], { attempts: 3, lastFailureAt: '2026-06-16T09:00:00.000Z' })
    ])

    expect(group.failureTitle).toContain('3–5 of 5 attempts')
    expect(group.failureTitle).toContain('2026-06-16T10:10:00Z')
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

  test('marks a group of dead letters by the state its members share', () => {
    expect(groupsOf(storm([32, 34]))[0].isDeadLetter).toBe(true)
    expect(
      groupsOf(storm([32, 34], { status: 'PUBLISHED' }))[0].isDeadLetter
    ).toBe(false)
  })

  // And an outbox row's line two is the topic alone — the arrow already says
  // the message left, so the word `outbox` was only taking room from it.
  test('reads a GAS outbox row bound for Caseworking as the hop it is', () => {
    expect(
      routeOf({
        service: 'gas',
        box: 'outbox',
        source: null,
        target: 'cw__sns__update_status_fifo'
      })
    ).toEqual({
      headline: 'GAS → Caseworking',
      detail: 'via cw__sns__update_status_fifo'
    })
  })

  // The arrow lives in the template, muted, so it never reads as loudly as the
  // two names it joins.
  test('names each end of the route on its own', () => {
    expect(rowFor()).toMatchObject({
      routeFrom: 'GAS',
      routeTo: 'Caseworking'
    })
  })

  test('reads a Caseworking outbox row bound for GAS', () => {
    expect(
      routeOf({
        service: 'caseworking',
        box: 'outbox',
        source: null,
        target: 'gas__sns__case_event'
      })
    ).toEqual({
      headline: 'Caseworking → GAS',
      detail: 'via gas__sns__case_event'
    })
  })

  test('reads an internal outbox row as going nowhere but itself', () => {
    expect(routeOf({ target: 'internal' })).toEqual({
      headline: 'GAS → GAS',
      detail: 'via internal'
    })
  })

  test('names Caseworking on both ends of its own internal row', () => {
    expect(
      routeOf({ service: 'caseworking', target: 'internal' }).headline
    ).toBe('Caseworking → Caseworking')
  })

  test('reads an audit outbox row as bound for Audit', () => {
    expect(routeOf({ target: 'audit' })).toEqual({
      headline: 'GAS → Audit',
      detail: 'via audit'
    })
  })

  // The suffix is the queue the message travelled on, in parentheses after the
  // hop. Its `cw__sns__` preamble names the destination service and the
  // transport, both of which the sentence in front of it has just said in
  // full, so the prefix goes before the cut and the discriminating tail
  // survives it. The whole raw topic goes on the cell's title.
  test('strips the routing prefix from the topic the cell shows', () => {
    const row = rowFor({ target: 'cw__sns__update_status_fifo' })

    expect(row.routeDetail).toBe('via cw__sns__update_status_fifo')
    expect(row.routeDetailShort).toBe('via update_status_fifo')
  })

  test('strips an sqs prefix the same way, and keeps the .fifo suffix', () => {
    expect(
      rowFor({ target: 'cw__sqs__create_new_case_fifo.fifo' }).routeDetailShort
    ).toBe('via create_new_case_fifo.fifo')
    expect(
      rowFor({ target: 'gas__sqs__audit_topic_arn' }).routeDetailShort
    ).toBe('via audit_topic_arn')
  })

  // Long enough to hold what the prefix used to crowd out, and no longer: a
  // topic past that is cut, and the whole of it is one hover away.
  test('cuts a topic still too long once the prefix is off it', () => {
    const row = rowFor({
      target: 'cw__sns__update_status_of_a_very_long_topic_name'
    })

    expect(row.routeDetailShort).toBe('via update_status_of_a_very_lo…')
    expect(row.routeDetail).toBe(
      'via cw__sns__update_status_of_a_very_long_topic_name'
    )
  })

  test('leaves a topic with no prefix to strip whole', () => {
    const row = rowFor({ target: 'audit' })

    expect(row.routeDetailShort).toBe('via audit')
    expect(row.routeDetailShort).toBe(row.routeDetail)
  })

  // An inbox row names the box it is sitting in, which is short by
  // construction: there is nothing there to cut.
  test('never cuts the suffix of an inbox row', () => {
    const row = rowFor({ box: 'inbox', source: 'CW', target: null })

    expect(row.routeDetail).toBe('gas inbox')
    expect(row.routeDetailShort).toBe('gas inbox')
  })

  // A topic that fits no prefix is named as the endpoint wrote it: flattening
  // it to "unknown" would hide the one string worth grepping for.
  test('names a target it recognises no prefix on as the endpoint wrote it', () => {
    expect(routeOf({ target: 'sqs__legacy_queue' })).toEqual({
      headline: 'GAS → sqs__legacy_queue',
      detail: 'via sqs__legacy_queue'
    })
  })

  // There is no service on the far end of an unconventional topic, so the
  // topic itself is the destination — and the `(via …)` suffix that would
  // repeat it word for word is not drawn at all.
  test('makes an unrecognised topic the destination, and drops the suffix', () => {
    const row = rowFor({ target: 'grant_application_created_fifo' })

    expect(row.routeTo).toBe('grant_application_created_fifo')
    expect(row.routeToIsTopic).toBe(true)
    expect(row.routeToTitle).toBe('grant_application_created_fifo')
    expect(row.routeDetailShort).toBe('')
  })

  // Only the transport prefix goes: it names the service and the queue type,
  // both of which the sentence in front of the arrow has already said.
  test('strips the transport prefix off a topic it puts on the arrow', () => {
    expect(rowFor({ target: 'legacy__sqs__old_queue' }).routeTo).toBe(
      'old_queue'
    )
    expect(rowFor({ target: 'legacy__sqs__old_queue' }).routeToTitle).toBe(
      'legacy__sqs__old_queue'
    )
  })

  // A route that points at a service we do name is a sentence, not a string:
  // it keeps the full name and keeps its parenthetical.
  test('leaves a recognised destination alone, suffix and all', () => {
    const row = rowFor({ target: 'cw__sns__update_status_fifo' })

    expect(row.routeTo).toBe('Caseworking')
    expect(row.routeToIsTopic).toBe(false)
    expect(row.routeToTitle).toBeNull()
    expect(row.routeDetailShort).toBe('via update_status_fifo')
  })

  test('says unknown when an outbox row names no target at all', () => {
    expect(routeOf({ target: null })).toEqual({
      headline: 'GAS → unknown',
      detail: 'via -'
    })
    expect(rowFor({ target: null }).routeToIsTopic).toBe(false)
  })

  // Line two names the box the row is sitting in and whose it is: a lone
  // `inbox` said nothing the arrow above it had not already said.
  test('reads a Caseworking inbox row by who produced it', () => {
    expect(
      routeOf({
        service: 'caseworking',
        box: 'inbox',
        source: 'GAS',
        target: null
      })
    ).toEqual({ headline: 'GAS → Caseworking', detail: 'cw inbox' })
  })

  test('reads a GAS inbox row from Caseworking', () => {
    expect(routeOf({ box: 'inbox', source: 'CW', target: null }).headline).toBe(
      'Caseworking → GAS'
    )
  })

  test('spells out the application service on an inbox row', () => {
    expect(routeOf({ box: 'inbox', source: 'AS', target: null }).headline).toBe(
      'Agreements → GAS'
    )
  })

  test('says unknown when an inbox row names no producer', () => {
    expect(routeOf({ box: 'inbox', source: null, target: null }).headline).toBe(
      'unknown → GAS'
    )
  })

  // The wire types name the four sources we know, but `status` already proves
  // the endpoint can pass a value through unrecognised. A service or box it
  // ever widens to must read as itself rather than vanishing from the column.
  test('names a service it has no label for by the name the endpoint used', () => {
    expect(
      routeOf({
        service: 'reporting' as unknown as EventService,
        box: 'inbox',
        source: 'GAS',
        target: null
      }).headline
    ).toBe('GAS → reporting')
  })

  test('names a box it has no label for by the name the endpoint used', () => {
    expect(
      routeOf({
        box: 'deadletter' as unknown as EventBox,
        source: 'CW',
        target: null
      })
    ).toEqual({ headline: 'Caseworking → GAS', detail: 'gas deadletter' })
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

  test('carries the segregation reference through', () => {
    expect(
      rowFor({ segregationRef: 'GLD-9B2-BWS-grasslands' }).segregationRef
    ).toBe('GLD-9B2-BWS-grasslands')
  })

  test('carries the segregation reference of a healthy row too', () => {
    expect(
      rowFor({ status: 'COMPLETED', segregationRef: 'SFI-2A1-ARA-arable' })
        .segregationRef
    ).toBe('SFI-2A1-ARA-arable')
  })

  // The type is the line an operator scans; the id only has to tell one row
  // from its neighbours, and the whole of it is on the title. Eight characters
  // is the first group of a uuid, so the cut lands on the hyphen the reader
  // can already see rather than three characters into the group after it.
  test('shortens the event id to the first group of its uuid', () => {
    const row = rowFor({ eventId: '3f2c1a0e-1111-2222-3333-444455556666' })

    expect(row.eventIdShort).toBe('3f2c1a0e…')
    expect(row.eventId).toBe('3f2c1a0e-1111-2222-3333-444455556666')
  })

  test('leaves an id no longer than that whole, and unellipsised', () => {
    expect(rowFor({ eventId: '3f2c1a0e' }).eventIdShort).toBe('3f2c1a0e')
    expect(rowFor({ eventId: 'abc' }).eventIdShort).toBe('abc')
  })

  test('shortens a mongo object id too', () => {
    expect(rowFor({ eventId: '665f1c2e9a1b2c3d4e5f6a7b' }).eventIdShort).toBe(
      '665f1c2e…'
    )
  })

  // One identifier grammar in the Event column. A message type is lowercase
  // and dotted; an audit row arrives spelling the same idea in screaming
  // snake, which read as urgent next to it. The endpoint's own spelling stays
  // on the title, which is where a grep needs it.
  test('lowercases the derived half of an audit type, raw on the title', () => {
    const row = rowFor({
      eventId: '665f1c2e9a1b2c3d4e5f6a7b',
      type: 'audit · CASE.CREATE_CASE',
      fullType: null
    })

    expect(row.eventId).toBe('665f1c2e9a1b2c3d4e5f6a7b')
    expect(row.type).toBe('audit · case.create_case')
    expect(row.typeTitle).toBe('audit · CASE.CREATE_CASE')
  })

  // A tooltip repeating the text under the cursor is noise, so a type the
  // page shows verbatim carries none.
  test('hangs no title off a type the column shows as it stands', () => {
    expect(rowFor().type).toBe('case.status.updated')
    expect(rowFor().typeTitle).toBeNull()
  })

  test('carries a row whose type could not be derived', () => {
    expect(rowFor({ type: '-' }).type).toBe('-')
    expect(rowFor({ type: '-' }).typeTitle).toBeNull()
  })

  test('carries the displayed type and its title onto the group', () => {
    const [group] = groupsOf(
      storm([32, 34], { type: 'audit · CASE.CREATE_CASE' })
    )

    expect(group.type).toBe('audit · case.create_case')
    expect(group.typeTitle).toBe('audit · CASE.CREATE_CASE')
  })

  // Sentence case, like the badges: one vocabulary for the two places the
  // same six words are written. The raw enum stays on the href.
  test('offers a chip for All and for each status a message passes through', () => {
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
        unavailable: true
      },
      {}
    )

    expect(unavailable).toBe(true)
    expect(rows).toHaveLength(0)
  })

  test('links every row at plain Discover on the shared index pattern', () => {
    givenLogsExplorer()

    expect(rowFor().traceHref).toBe(
      `${logsBase}/_dashboards/app/data-explorer/discover/#` +
        `?_a=(discover:(columns:!(container_name,message,log.level,trace.id),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:e55f3890-5d4a-11ee-8f40-670c9b0b8093,view:discover))` +
        `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-06-16T04:00:00.000Z',to:'2026-06-16T16:00:00.000Z'))` +
        `&_q=(filters:!(),query:(language:kuery,query:'trace.id:%22${traceId}%22'))`
    )
  })

  test('links a Caseworking row identically — the search is cross-service', () => {
    givenLogsExplorer()

    const gas = rowFor().traceHref
    const cw = rowFor({ service: 'caseworking', box: 'inbox' }).traceHref

    expect(cw).toBe(gas)
    expect(cw).not.toContain('savedSearch')
    expect(cw).not.toContain('container_name:')
  })

  test('carries the trace id inside the kuery, quoted as %22', () => {
    givenLogsExplorer()

    expect(rowFor().traceHref).toContain(`query:'trace.id:%22${traceId}%22'`)
  })

  test('windows the search six hours either side of the event', () => {
    givenLogsExplorer()

    const href = rowFor({ createdAt: '2026-06-16T13:30:00.000Z' }).traceHref

    expect(href).toContain(
      "time:(from:'2026-06-16T07:30:00.000Z',to:'2026-06-16T19:30:00.000Z')"
    )
  })

  test('windows across a date boundary without losing the day', () => {
    givenLogsExplorer()

    const href = rowFor({ createdAt: '2026-06-16T02:00:00.000Z' }).traceHref

    expect(href).toContain(
      "time:(from:'2026-06-15T20:00:00.000Z',to:'2026-06-16T08:00:00.000Z')"
    )
  })

  test('has no link when the row carries no trace id', () => {
    givenLogsExplorer()

    expect(rowFor({ traceId: null }).traceHref).toBeNull()
  })

  test('has no link when no logs explorer is configured', () => {
    expect(rowFor().traceHref).toBeNull()
  })

  test('has no link when the configured base url is blank', () => {
    givenLogsExplorer('')

    expect(rowFor().traceHref).toBeNull()
  })

  test('has no link when the row has an unparseable created time', () => {
    givenLogsExplorer()

    expect(rowFor({ createdAt: 'not-a-date' }).traceHref).toBeNull()
  })

  test('keeps a bare CDP request id as the trace id', () => {
    givenLogsExplorer()

    expect(rowFor({ traceId: 'cdp-request-id-1' }).traceHref).toContain(
      "query:'trace.id:%22cdp-request-id-1%22'"
    )
  })

  test('url-encodes a trace id that would otherwise escape the href', () => {
    givenLogsExplorer()

    const href = rowFor({ traceId: '" onmouseover=alert(1) x="' }).traceHref

    expect(href).not.toContain('"')
    expect(href).not.toContain(' ')
    expect(href).toContain('%22%20onmouseover%3Dalert(1)%20x%3D%22')
  })

  test("escapes a trace id's rison quote so it cannot close the query", () => {
    givenLogsExplorer()

    const href = rowFor({ traceId: "a'),b:(c" }).traceHref

    // `'` is rison-escaped to `!'`, so the query string still ends at the
    // one closing quote this template writes.
    expect(href).toContain("query:'trace.id:%22a!')%2Cb%3A(c%22'))")
    expect(href?.endsWith("%22'))")).toBe(true)
  })

  test('doubles a rison escape character in a trace id', () => {
    givenLogsExplorer()

    expect(rowFor({ traceId: 'a!f' }).traceHref).toContain(
      'trace.id:%22a!!f%22'
    )
  })

  // The whole trace id is the link's title; the identity cell has no room to
  // set it, and no reason to.
  test('carries the whole trace id for the link title', () => {
    givenLogsExplorer()

    expect(rowFor().traceId).toBe(traceId)
  })

  test('has a null trace id when the row carries no trace', () => {
    expect(rowFor({ traceId: null }).traceId).toBeNull()
  })

  // A run of one is still a group: the template walks one list, not two
  // interleaved ones, and decides on `grouped` what to draw.
  test('leaves a row with nothing beside it as a group of one', () => {
    expect(shapeOf([event()])).toEqual([{ count: 1, grouped: false }])
  })

  test('folds a run of identical rows into one group', () => {
    expect(shapeOf(storm([32, 34, 36, 38]))).toEqual([
      { count: 4, grouped: true }
    ])
  })

  test('counts the members and labels the chip with the count', () => {
    const [group] = groupsOf(storm([32, 34, 36]))

    expect(group.count).toBe(3)
    expect(group.countLabel).toBe('×3')
  })

  // The chip stays a figure — `×3 events` down a column of them is the word
  // three times — and says what it is counting on its title instead.
  test('spells out what the chip counts, and what opening it will do', () => {
    const [group] = groupsOf(storm([32, 34, 36]))

    expect(group.countTitle).toBe('3 events in this group')
    expect(group.expandTitle).toBe('Click to expand 3 events')
  })

  test('keeps the members in the order the endpoint returned them', () => {
    const [group] = groupsOf(storm([32, 34, 36]))

    expect(group.rows.map((row) => row.eventId)).toEqual([
      'storm-0',
      'storm-1',
      'storm-2'
    ])
  })

  // Every part of the key is checked on its own, because each is a different
  // reason two rows are not the same event.
  test('breaks a run where the status changes', () => {
    expect(
      shapeOf([
        ...storm([32, 34]),
        ...storm([36], { status: 'FAILED' }),
        ...storm([38])
      ])
    ).toEqual([
      { count: 2, grouped: true },
      { count: 1, grouped: false },
      { count: 1, grouped: false }
    ])
  })

  test('breaks a run where the type changes', () => {
    expect(
      shapeOf([...storm([32, 34]), ...storm([36], { type: 'case.created' })])
    ).toEqual([
      { count: 2, grouped: true },
      { count: 1, grouped: false }
    ])
  })

  test('breaks a run where the segregation reference changes', () => {
    expect(
      shapeOf([
        ...storm([32, 34]),
        ...storm([36, 38], { segregationRef: 'SFI-2A1-ARA-arable' })
      ])
    ).toEqual([
      { count: 2, grouped: true },
      { count: 2, grouped: true }
    ])
  })

  test('breaks a run where the route changes', () => {
    expect(
      shapeOf([
        ...storm([32, 34]),
        ...storm([36], { target: 'gas__sns__case_event' })
      ])
    ).toEqual([
      { count: 2, grouped: true },
      { count: 1, grouped: false }
    ])
  })

  // Both rows read `GAS → GAS`, so only the box tells them apart — and an
  // outbox row and the inbox row it lands in are not the same event.
  test('breaks a run where only the box differs', () => {
    expect(
      shapeOf([
        ...storm([32], { box: 'outbox', target: 'internal', source: null }),
        ...storm([34], { box: 'inbox', target: null, source: 'GAS' })
      ])
    ).toEqual([
      { count: 1, grouped: false },
      { count: 1, grouped: false }
    ])
  })

  // Consecutive, never a regroup of the page: the endpoint's order is the
  // operator's order, and hoisting a row out of its place to sit with a match
  // twelve rows above it would quietly rewrite the timeline.
  test('never joins two matching runs across a row between them', () => {
    expect(
      shapeOf([
        ...storm([30, 32]),
        ...storm([34], { status: 'FAILED' }),
        ...storm([36, 38])
      ])
    ).toEqual([
      { count: 2, grouped: true },
      { count: 1, grouped: false },
      { count: 2, grouped: true }
    ])
  })

  test('never groups two identical rows that are not next to each other', () => {
    expect(
      shapeOf([
        ...storm([30]),
        ...storm([32], { type: 'case.created' }),
        ...storm([34])
      ]).every(({ grouped }) => !grouped)
    ).toBe(true)
  })

  // The Created column is read down its right edge, so a summary says exactly
  // what a plain row says: one relative time, the newest member's.
  test('ages a group by its newest member, as a plain row is aged', () => {
    expect(groupsOf(storm([212, 214, 218]))[0].createdAt).toBe('3h 32m ago')
  })

  test('states one time when the members round to the same age', () => {
    expect(groupsOf(storm([212, 212]))[0].createdAt).toBe('3h 32m ago')
  })

  // Demoted, not lost: the span opens the title, above the two absolutes.
  test('carries the span and both ends of it on the title', () => {
    const [group] = groupsOf(storm([212, 218]))

    expect(group.createdAtTitle).toBe(
      '3h 32m – 3h 38m ago\n' +
        'Newest: 2026-06-16T06:48:00Z   ·   16 Jun 2026, 07:48:00 BST (Europe/London)\n' +
        'Oldest: 2026-06-16T06:42:00Z   ·   16 Jun 2026, 07:42:00 BST (Europe/London)'
    )
  })

  test('carries the single absolute when the span reads as one time', () => {
    expect(groupsOf(storm([212, 212]))[0].createdAtTitle).toBe(
      '2026-06-16T06:48:00Z   ·   16 Jun 2026, 07:48:00 BST (Europe/London)'
    )
  })

  // The newest failure is the one that says whether the storm is still going.
  test('reports the newest failure in the group', () => {
    const [group] = groupsOf([
      ...storm([32], { lastFailureAt: '2026-06-16T10:10:00.000Z' }),
      ...storm([34], { lastFailureAt: '2026-06-16T09:00:00.000Z' })
    ])

    expect(group.hasFailure).toBe(true)
    expect(group.lastFailureAt).toBe('10m ago')
    expect(group.failureTitle).toContain('2026-06-16T10:10:00Z')
  })

  test('reports no failure for a group where nothing ever failed', () => {
    const [group] = groupsOf(
      storm([32, 34], { status: 'PUBLISHED', attempts: 1, lastFailureAt: null })
    )

    expect(group.hasFailure).toBe(false)
    expect(group.showAttempts).toBe(false)
  })

  test('states the attempt count the members share', () => {
    const [group] = groupsOf(storm([32, 34]))

    expect(group.attempts).toBe('5/5')
    expect(group.attemptsAtMax).toBe(true)
    expect(group.showAttempts).toBe(true)
  })

  // One straggler still has a retry left, so the group has not finished
  // failing — and the count says a range rather than passing one member's
  // number off as the group's.
  test('states a range when the members do not share a count', () => {
    const [group] = groupsOf([
      ...storm([32], { attempts: 5 }),
      ...storm([34], { attempts: 3 })
    ])

    expect(group.attempts).toBe('3–5/5')
    expect(group.attemptsAtMax).toBe(false)
  })

  test('carries the shared facets onto the group', () => {
    const [group] = groupsOf(storm([32, 34]))

    expect(group).toMatchObject({
      type: 'case.status.updated',
      segregationRef: 'GLD-9B2-BWS-grasslands',
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter',
      statusRole: 'error',
      routeFrom: 'GAS',
      routeTo: 'Caseworking',
      routeDetail: 'via cw__sns__update_status_fifo',
      routeDetailShort: 'via update_status_fifo'
    })
  })

  // Opening one group must never close another: an operator comparing two
  // storms needs both of them open.
  test('names every group on the page differently', () => {
    const names = groupsOf([
      ...storm([30, 32]),
      ...storm([34, 36], { type: 'case.created' })
    ]).map((group) => group.name)

    expect(names).toEqual(['events-group-1', 'events-group-2'])
    expect(new Set(names).size).toBe(2)
  })

  // Grouping is presentational. The pager counts rows, the rollup counts rows,
  // and folding a storm must change neither number.
  // The page's one arithmetic: the lines an operator can see, and the rows
  // behind them. A run of one is drawn as a plain row, so it is not a group.
  test('counts the runs that actually fold, and the rows on the page', () => {
    const page = model([...storm([30, 32, 34]), event({ id: 'alone' })])

    expect(page.groupCount).toBe(1)
    expect(page.eventCount).toBe(4)
  })

  test('counts no groups at all on a page that folded nothing', () => {
    const page = model([event({ id: '1' }), event({ id: '2', type: 'other' })])

    expect(page.groupCount).toBe(0)
    expect(page.eventCount).toBe(2)
  })

  test('counts nothing on an empty page', () => {
    expect(model([]).groupCount).toBe(0)
    expect(model([]).eventCount).toBe(0)
  })

  test('keeps every row flat as well as grouped', () => {
    const { rows, groups } = model([...storm([30, 32, 34]), event()])

    expect(rows).toHaveLength(4)
    expect(groups).toHaveLength(2)
    expect(rows.map((row) => row.eventId)).toEqual([
      'storm-0',
      'storm-1',
      'storm-2',
      '3f2c1a0e-1111-2222-3333-444455556666'
    ])
  })

  test('groups two rows that both carry no reference at all', () => {
    const [group] = groupsOf(storm([30, 32], { segregationRef: null }))

    expect(group.count).toBe(2)
    expect(group.segregationRef).toBeNull()
  })

  test('states a group count against a maximum the endpoint never sent', () => {
    expect(groupsOf(storm([30, 32], { maxAttempts: null }))[0].attempts).toBe(
      '5/?'
    )
  })

  test('groups nothing on an empty page', () => {
    expect(model([]).groups).toEqual([])
  })

  test('counts what each of the four buckets holds', () => {
    const { buckets } = rollupOf([
      event({ id: '1', status: 'DEAD_LETTER' }),
      event({ id: '2', status: 'FAILED' }),
      event({ id: '3', status: 'RESUBMITTED' }),
      event({ id: '4', status: 'PUBLISHED' }),
      event({ id: '5', status: 'PROCESSING' }),
      event({ id: '6', status: 'COMPLETED' })
    ])

    expect(buckets).toEqual([
      { label: 'dead-lettered', count: 1, deadLettered: true },
      { label: 'retrying', count: 2, deadLettered: false },
      { label: 'in flight', count: 2, deadLettered: false },
      { label: 'completed', count: 1, deadLettered: false }
    ])
  })

  // An empty bucket is not a fact worth a line of the strip. `0 completed`
  // reads as a problem on a page where nothing was ever meant to complete.
  test('names only the buckets that hold something', () => {
    expect(rollupOf(storm([30, 32])).buckets).toEqual([
      { label: 'dead-lettered', count: 2, deadLettered: true }
    ])
  })

  // The strip counts what it can stand behind. A status the endpoint invents
  // belongs to none of the four, and the rows below say the rest.
  test('counts a status it does not know into no bucket at all', () => {
    expect(rollupOf([event({ status: 'QUARANTINED' })]).buckets).toEqual([])
  })

  test('names the oldest row on the page, with its absolute on the title', () => {
    const { oldest, oldestTitle } = rollupOf([
      event({ id: '1', createdAt: '2026-06-16T10:00:00.000Z' }),
      event({ id: '2', createdAt: '2026-06-16T06:33:00.000Z' }),
      event({ id: '3', createdAt: '2026-06-16T09:00:00.000Z' })
    ])

    expect(oldest).toBe('3h 47m ago')
    expect(oldestTitle).toBe(
      '2026-06-16T06:33:00Z   ·   16 Jun 2026, 07:33:00 BST (Europe/London)'
    )
  })

  test('names no oldest row on a page with none', () => {
    const { oldest, oldestTitle, buckets } = rollupOf([])

    expect(oldest).toBeNull()
    expect(oldestTitle).toBe('')
    expect(buckets).toEqual([])
  })

  test('ignores an unreadable created time when finding the oldest', () => {
    expect(
      rollupOf([
        event({ id: '1', createdAt: 'nope' }),
        event({ id: '2', createdAt: '2026-06-16T09:00:00.000Z' })
      ]).oldest
    ).toBe('1h 20m ago')
  })

  test('has no rows when nothing was found', () => {
    const { rows, previousHref, nextHref, unavailableSources } = model([])

    expect(rows).toHaveLength(0)
    expect(previousHref).toBeNull()
    expect(nextHref).toBeNull()
    expect(unavailableSources).toBe('')
  })

  // The page renders against request time when nobody hands it a clock.
  test('falls back to the wall clock when no time is given', () => {
    const { rows } = toEventsPage(
      result([event({ createdAt: new Date().toISOString() })]),
      {}
    )

    expect(rows[0].createdAt).toBe('0s ago')
  })
})
