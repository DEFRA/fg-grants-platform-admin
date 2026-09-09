import { config } from '../../common/config.ts'
import type {
  EventDetail,
  EventKey,
  EventResult,
  JourneyHop
} from '../use-cases/get-event.use-case.ts'
import type {
  EventRow,
  ServiceFilter
} from '../use-cases/get-events.use-case.ts'
import { toEventPage, toSafeFrom } from './event-page.view-model.ts'
import { toEventsPage } from './events-page.view-model.ts'

vi.mock(import('../../common/config.ts'))

const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

/**
 * The links are off until a deployment names a logs explorer, so every
 * assertion about one turns it on for itself. `clearMocks` wipes the write
 * between tests.
 */
const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const now = new Date('2026-06-16T10:20:00.000Z')

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const key: EventKey = { service: 'gas', box: 'outbox', id }

/**
 * An inbox row is the only half of the pattern that can answer for a
 * reference or a trace, so the tests about those are asked of one.
 */
const inboxKey: EventKey = { service: 'gas', box: 'inbox', id }

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'Caseworking' }
]

/**
 * The state an event is in, in the words fg-gas-backend spells it: one fact,
 * so the fields travel together.
 */
const deadLetter = {
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error' as const,
  statusRetrying: false,
  attempts: '5/5',
  showAttempts: true
}

const completed = {
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success' as const,
  statusRetrying: false,
  attempts: '1/5',
  showAttempts: false
}

const stateOf = (status: string, label = status) => ({
  status,
  statusLabel: label,
  statusRole: 'neutral' as const,
  statusRetrying: false,
  attempts: '1/5',
  showAttempts: false
})

/** The fields the list row and the detail share, on an outbox message. */
const base = {
  service: 'gas' as const,
  box: 'outbox' as const,
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  hop: 'GAS Outbox',
  queue: 'to Caseworking',
  queueValue: 'gas__sns__update_case_status_fifo',
  ...deadLetter,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    at: '2026-06-16T10:16:05.000Z'
  }
}

/**
 * One outbox message in full. It carries none of the three inbox-only facts:
 * something this service published has no reference to segregate by and no
 * trace of its own, so the keys are absent rather than null.
 */
const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  ...base,
  attemptHistory: [
    {
      at: '2026-06-16T10:08:00.000Z',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms',
      stack: null
    },
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events index: id_1',
      stack: null
    }
  ],
  payload: { data: { caseRef: 'GLD-9B2' } },
  typeTitle: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  occurredAt: null,
  messageGroupId: 'GLD-9B2',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastRedrive: null,
  ...overrides
})

/**
 * The same message as the box that received it holds it: a producer on line
 * two rather than a topic, and the reference and the trace it arrived on.
 * `publicationDate` is when this service got it, which is the only baseline
 * its own timings can honestly be measured from.
 */
const inboxDetail = (overrides: Partial<EventDetail> = {}): EventDetail =>
  detail({
    box: 'inbox',
    hop: 'GAS Inbox',
    queue: 'from Caseworking',
    queueValue: null,
    messageGroupId: null,
    occurredAt: '2026-06-16T09:59:58.000Z',
    segregationRef: 'GLD-9B2-BWS-grasslands',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    ...overrides
  })

/** One hop of the journey, as the endpoint composes it. */
const hop = (overrides: Partial<JourneyHop> = {}): JourneyHop => ({
  service: 'gas',
  box: 'outbox',
  id,
  hop: 'GAS Outbox',
  ...deadLetter,
  startedAt: '2026-06-16T10:00:01.000Z',
  took: '1.2s',
  ...overrides
})

const found = (
  event: EventDetail = detail(),
  journey: JourneyHop[] = [hop()]
): EventResult => ({ outcome: 'found', event, journey })

const model = (
  result: EventResult = found(),
  query: Parameters<typeof toEventPage>[2] = {}
) => toEventPage(result, key, query, now)

/** The same page, asked about the inbox half of the pattern. */
const inboxModel = (
  result: EventResult = found(inboxDetail()),
  query: Parameters<typeof toEventPage>[2] = {}
) => toEventPage(result, inboxKey, query, now)

describe('toSafeFrom', () => {
  test.each([
    ['?status=DEAD_LETTER', '?status=DEAD_LETTER'],
    ['?cursor=a%2Bb&direction=forward', '?cursor=a%2Bb&direction=forward'],
    ['?', '?']
  ])('keeps %s', (from, expected) => {
    expect(toSafeFrom(from)).toBe(expected)
  })

  // The two shapes that turn `/dev-ops/events` plus a suffix into a link
  // somewhere else, and the ones that are simply not a query string.
  test.each([
    ['an absolute url', 'https://example.com'],
    ['a protocol-relative url', '//example.com'],
    ['a query hiding one', '?next=//example.com'],
    ['a path', '/dev-ops/events'],
    ['a bare needle', 'status=FAILED'],
    ['an empty string', ''],
    ['nothing at all', undefined]
  ])('drops %s', (_name, from) => {
    expect(toSafeFrom(from)).toBe('')
  })
})

describe('toEventPage', () => {
  test('links back to the plain list when there is no query to keep', () => {
    expect(model().backHref).toBe('/dev-ops/events')
  })

  test('links back to the list the operator left', () => {
    expect(model(found(), { from: '?status=FAILED' }).backHref).toBe(
      '/dev-ops/events?status=FAILED'
    )
  })

  test('links back to the plain list when the query is not one', () => {
    expect(model(found(), { from: '//example.com' }).backHref).toBe(
      '/dev-ops/events'
    )
  })

  // Every word here is the endpoint's, and the page prints them: a status
  // labelled in two places eventually reads two ways.
  test('names the event and the state the endpoint says it is in', () => {
    const page = model()

    expect(page.type).toBe('case.status.updated')
    expect(page.typeTitle).toBe(
      'cloud.defra.prd.fg-gas-backend.case.update.status'
    )
    expect(page.status).toBe('DEAD_LETTER')
    expect(page.statusLabel).toBe('Dead letter')
    expect(page.statusRole).toBe('error')
    expect(page.statusRetrying).toBe(false)
    expect(page.attempts).toBe('5/5')
    expect(page.showAttempts).toBe(true)
  })

  // The fuller spelling is sent only where it says something the short one
  // does not, so there is nothing left here to compare it against.
  test('hangs no title off a type the endpoint sent no fuller spelling for', () => {
    expect(model(found(detail({ typeTitle: null }))).typeTitle).toBeNull()
  })

  test('says the created instant absolutely, and only absolutely', () => {
    const page = model()

    expect(page.createdAtAbsolute).toBe('2026-06-16T10:00:00Z')
    expect(page).not.toHaveProperty('createdAt')
    expect(page).not.toHaveProperty('createdAtLondon')
  })

  test('states the poller dates absolutely, and a dash where there is none', () => {
    const page = model()

    expect(page.publicationDate).toBe('2026-06-16T10:00:01Z')
    expect(page.completedDate).toBe('—')
    expect(page.lastResubmissionDate).toBe('—')
    expect(page.claimedAt).toBe('—')
    expect(page.claimExpiresAt).toBe('—')
  })

  test('pretty-prints the payload at two spaces', () => {
    expect(model().payloadJson).toBe(
      '{\n  "data": {\n    "caseRef": "GLD-9B2"\n  }\n}'
    )
  })

  // A stored null is a real payload and says so; only nothing at all is empty.
  test('prints a stored null as a payload', () => {
    expect(model(found(detail({ payload: null }))).payloadJson).toBe('null')
  })

  test('has nothing to print when the endpoint sent no payload', () => {
    expect(model(found(detail({ payload: undefined }))).payloadJson).toBeNull()
  })

  test('reads the failure in full, class and instant apart', () => {
    const page = model()

    expect(page.errorName).toBe('MongoServerError')
    expect(page.errorMessage).toBe('E11000 duplicate key')
    expect(page.errorAt).toBe('2026-06-16T10:16:05Z')
  })

  test('reports no failure on an event that never had one', () => {
    const page = model(found(detail({ lastError: null })))

    expect(page.errorName).toBeNull()
    expect(page.errorMessage).toBeNull()
    expect(page.errorAt).toBeNull()
  })

  test('reads a failure the endpoint recorded without an instant', () => {
    const page = model(
      found(detail({ lastError: { name: 'Error', message: 'no', at: null } }))
    )

    expect(page.errorMessage).toBe('no')
    expect(page.errorAt).toBeNull()
  })

  test('names each hop of the journey and links it at its own page', () => {
    const page = model(
      found(detail(), [
        hop(),
        hop({
          id: '111111111111111111111111',
          service: 'caseworking',
          box: 'inbox',
          hop: 'CW Inbox'
        })
      ])
    )

    expect(page.journey.map((entry) => entry.source)).toEqual([
      'GAS Outbox',
      'CW Inbox'
    ])
    expect(page.journey.map((entry) => entry.href)).toEqual([
      `/dev-ops/events/gas/outbox/${id}`,
      '/dev-ops/events/caseworking/inbox/111111111111111111111111'
    ])
    expect(page.journey).toHaveLength(2)
  })

  test('draws each hop in the words the endpoint sent for it', () => {
    const page = model(
      found(detail(), [
        hop({
          status: 'COMPLETED',
          statusLabel: 'Completed',
          statusRole: 'success',
          statusRetrying: false
        })
      ])
    )

    expect(page.journey[0]).toMatchObject({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      statusRole: 'success',
      statusRetrying: false
    })
  })

  test('marks the hop the page is already about', () => {
    const page = model(
      found(detail(), [hop(), hop({ id: '111111111111111111111111' })])
    )

    expect(page.journey.map((entry) => entry.isCurrent)).toEqual([true, false])
  })

  // Same id, same box, different service: not the same row.
  test('marks no hop that only half matches this address', () => {
    const page = model(found(detail(), [hop({ service: 'caseworking' })]))

    expect(page.journey[0].isCurrent).toBe(false)
  })

  test('carries the list query onto every journey link', () => {
    const page = model(found(), { from: '?status=FAILED' })

    expect(page.journey[0].href).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DFAILED`
    )
  })

  test('offers a redrive only on a dead-lettered event', () => {
    expect(model().canRedrive).toBe(true)
    expect(model(found(detail(stateOf('FAILED', 'Failed')))).canRedrive).toBe(
      false
    )
  })

  test('confirms a redrive only when it is asked for and allowed', () => {
    expect(model(found(), { confirm: 'redrive' }).confirmRedrive).toBe(true)
    expect(model().confirmRedrive).toBe(false)
    expect(
      model(found(detail(completed)), { confirm: 'redrive' }).confirmRedrive
    ).toBe(false)
  })

  test('points the confirmation and the write at this same event', () => {
    const page = model(found(), { from: '?status=DEAD_LETTER' })

    expect(page.redriveHref).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER&confirm=redrive`
    )
    expect(page.cancelHref).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER`
    )
    expect(page.redriveAction).toBe(`/dev-ops/events/gas/outbox/${id}/redrive`)
  })

  test('says a redrive was requested', () => {
    expect(model(found(), { redriven: '1' }).banner).toEqual({
      role: 'success',
      message:
        'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
    })
  })

  // The label travels on the redirect: this page prints the word it was
  // handed rather than translating an enum a second time.
  test('names the status a conflict reported, in the words it arrived in', () => {
    const banner = model(found(), { redrive_conflict: 'Completed' }).banner

    expect(banner?.role).toBe('warning')
    expect(banner?.message).toBe(
      'Not redriven — this event is no longer dead-lettered. Its status is now Completed.'
    )
  })

  test.each([
    ['missing', 'no longer has this event'],
    ['failed', 'could not be reached']
  ])('says what went wrong for a %s redrive', (error, sentence) => {
    const banner = model(found(), { redrive_error: error }).banner

    expect(banner?.role).toBe('error')
    expect(banner?.message).toContain(sentence)
  })

  test('shows no banner on a page nothing redirected to', () => {
    expect(model().banner).toBeNull()
  })

  // The shell still has to say the two things it can: the way back, and
  // whatever the redirect that landed here was carrying.
  test('keeps the way back on a page whose event could not be read', () => {
    const page = model(
      { outcome: 'unavailable', event: null, journey: [] },
      { from: '?status=FAILED' }
    )

    expect(page.unavailable).toBe(true)
    expect(page.backHref).toBe('/dev-ops/events?status=FAILED')
    expect(page.payloadJson).toBeNull()
    expect(page.journey).toEqual([])
    expect(page.canRedrive).toBe(false)
  })

  test('lists every attempt, oldest first and numbered as it happened', () => {
    const { attemptHistory } = model()

    expect(attemptHistory).toHaveLength(2)
    expect(attemptHistory.map(({ number }) => number)).toEqual(['#1', '#2'])
    expect(attemptHistory[0]).toEqual({
      number: '#1',
      absolute: '2026-06-16T10:08:00.000Z',
      delta: 'after 8m 0s',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms',
      stack: null,
      title: '2026-06-16T10:08:00Z'
    })
  })

  // Verbatim: a stack is not prose, and the backend capped it at the source.
  test('carries each attempt stack through untouched', () => {
    const stack = 'Error: boom\n    at handler (/app/src/x.js:1:1)'
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.000Z',
              name: 'Error',
              message: 'boom',
              stack
            }
          ]
        })
      )
    )

    expect(attemptHistory[0].stack).toBe(stack)
  })

  test('carries a null stack as null, so the page draws no expander', () => {
    expect(model().attemptHistory[0].stack).toBeNull()
  })

  test('says each attempt absolutely, and never how long ago it was', () => {
    const { attemptHistory } = model()

    expect(attemptHistory[1]).toMatchObject({
      absolute: '2026-06-16T10:16:05.000Z',
      delta: '+8m 5s'
    })
    expect(
      attemptHistory.map((entry) => entry.absolute).join(' ')
    ).not.toContain('ago')
    expect(attemptHistory[0]).not.toHaveProperty('relative')
  })

  // Four attempts inside a second is a service retrying into a wall —
  // invisible at a resolution that rounds all four to `12m ago`.
  test('makes a missing backoff visible as four sub-second deltas', () => {
    const { attemptHistory } = model(
      found(
        detail({
          createdAt: '2026-06-16T10:08:00.000Z',
          publicationDate: '2026-06-16T10:00:01.000Z',
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.120Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:00.393Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:00.905Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:02.005Z',
              name: 'E',
              message: 'boom',
              stack: null
            }
          ]
        })
      )
    )

    expect(
      attemptHistory.map(({ number, absolute, delta }) => [
        number,
        absolute,
        delta
      ])
    ).toEqual([
      ['#1', '2026-06-16T10:08:00.120Z', 'after 120ms'],
      ['#2', '2026-06-16T10:08:00.393Z', '+273ms'],
      ['#3', '2026-06-16T10:08:00.905Z', '+512ms'],
      ['#4', '2026-06-16T10:08:02.005Z', '+1.1s']
    ])
  })

  // The same shape, done properly: a backoff an operator can see is working.
  test('reads a real backoff as a widening run of deltas', () => {
    const { attemptHistory } = model(
      found(
        detail({
          createdAt: '2026-06-16T04:00:00.000Z',
          publicationDate: '2026-06-16T10:00:01.000Z',
          attemptHistory: [
            {
              at: '2026-06-16T04:00:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T04:02:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T09:36:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            }
          ]
        })
      )
    )

    expect(attemptHistory.map(({ delta }) => delta)).toEqual([
      'after 30.0s',
      '+2m 0s',
      '+5h 34m'
    ])
  })

  // An instant the endpoint wrote that will not parse leaves no gap to state,
  // and `+NaNms` is worse than saying nothing.
  test('states no delta for an instant it cannot read', () => {
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            { at: 'not a date', name: 'E', message: 'boom', stack: null },
            { at: 'nor this', name: 'E', message: 'boom', stack: null }
          ]
        })
      )
    )

    expect(
      attemptHistory.map(({ absolute, delta }) => [absolute, delta])
    ).toEqual([
      ['—', null],
      ['—', null]
    ])
  })

  // An empty section reads as "it never failed", which is the opposite of what
  // an empty history means on a dead letter — so the page says it in words.
  test('reports no attempts at all on an event that predates the history', () => {
    const { attemptHistory } = model(found(detail({ attemptHistory: [] })))

    expect(attemptHistory).toEqual([])
  })

  // A list of failures that simply stops reads as an event still failing.
  test('ends the timeline with the state the event is actually in', () => {
    expect(model().attemptOutcome).toBe('dead-lettered')
  })

  test('ends a completed event at the instant it completed', () => {
    expect(
      model(
        found(
          detail({
            ...completed,
            completionDate: '2026-06-16T10:17:00.000Z'
          })
        )
      ).attemptOutcome
    ).toBe('completed at 2026-06-16T10:17:00Z')
  })

  // A completion the endpoint did not date has no instant to end the story
  // with, and `completed at —` is worse than the sentence being absent.
  test('ends nothing on a completed event the endpoint dated no completion for', () => {
    expect(
      model(found(detail({ ...completed, completionDate: null })))
        .attemptOutcome
    ).toBeNull()
  })

  test('ends nothing on an event that is still in play', () => {
    expect(
      model(found(detail(stateOf('PROCESSING', 'Processing')))).attemptOutcome
    ).toBeNull()
  })

  // The one place in the app that builds a Discover href. A trace is one of
  // the facts only the receiving half of the pattern can answer for, so it is
  // asked of an inbox row throughout.
  test('links the trace at plain Discover on the shared index pattern', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel()

    expect(traceHref).toBe(
      `${logsBase}/_dashboards/app/data-explorer/discover/#` +
        `?_a=(discover:(columns:!(container_name,message,log.level,trace.id),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:e55f3890-5d4a-11ee-8f40-670c9b0b8093,view:discover))` +
        `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-06-16T04:00:01.000Z',to:'2026-06-16T16:00:01.000Z'))` +
        `&_q=(filters:!(),query:(language:kuery,query:'trace.id:%224bf92f3577b34da6a3ce929d0e0e4736%22'))`
    )
  })

  // Six hours either side, so a trace that started before the message and
  // finished after it is inside the window.
  test('windows the search six hours either side of the receipt', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ publicationDate: '2026-06-16T13:30:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-16T07:30:00.000Z'")
    expect(traceHref).toContain("to:'2026-06-16T19:30:00.000Z')")
  })

  // On an inbox row `createdAt` is the CloudEvent's own time — the producer's
  // clock, stamped before the broker saw it — so a window centred on it would
  // be centred somewhere this service was not yet involved.
  test('centres the window on receipt rather than on the producer stamp', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(
        inboxDetail({
          createdAt: '2026-06-16T02:00:00.000Z',
          publicationDate: '2026-06-16T13:30:00.000Z'
        })
      )
    )

    expect(traceHref).toContain("time:(from:'2026-06-16T07:30:00.000Z'")
  })

  // A row whose box recorded no receipt is timed from the only instant it has.
  test('falls back to the created instant on a row with no receipt', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(
        inboxDetail({
          createdAt: '2026-06-16T13:30:00.000Z',
          publicationDate: null
        })
      )
    )

    expect(traceHref).toContain("time:(from:'2026-06-16T07:30:00.000Z'")
  })

  test('windows across a date boundary without losing the day', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ publicationDate: '2026-06-16T02:00:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-15T20:00:00.000Z'")
  })

  test('links nothing on a row with no trace at all', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: null }))).traceHref
    ).toBeNull()
  })

  // An outbox row carries none of the three inbox-only facts at all, and each
  // is drawn as the dash it has always drawn rather than as an empty cell.
  test('reports no reference and no trace on an outbox row, which has neither', () => {
    givenLogsExplorer()

    expect(model()).toMatchObject({
      segregationRef: null,
      segregationRefHref: null,
      segregationRefTitle: null,
      traceparent: null,
      traceId: null,
      traceHref: null
    })
  })

  // An inbox row does, and the reference gathers the set the event id cannot.
  test('links an inbox row reference at every event that shares it', () => {
    expect(inboxModel()).toMatchObject({
      segregationRef: 'GLD-9B2-BWS-grasslands',
      segregationRefHref: '/dev-ops/events?q=GLD-9B2-BWS-grasslands',
      segregationRefTitle:
        'GLD-9B2-BWS-grasslands\nShow every event with this reference',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    })
  })

  test('links nothing when no logs explorer is configured', () => {
    expect(inboxModel().traceHref).toBeNull()
  })

  test('links nothing when the configured base url is blank', () => {
    givenLogsExplorer('')

    expect(inboxModel().traceHref).toBeNull()
  })

  test('links nothing when the row has an unparseable receipt instant', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ publicationDate: 'not-a-date' })))
        .traceHref
    ).toBeNull()
  })

  test('keeps a bare CDP request id as the trace id', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: 'cdp-request-id-1' }))).traceHref
    ).toContain("query:'trace.id:%22cdp-request-id-1%22'")
  })

  test('url-encodes a trace id that would otherwise escape the href', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ traceId: '" onmouseover=alert(1) x="' }))
    )

    expect(traceHref).not.toContain('"')
    expect(traceHref).not.toContain(' ')
  })

  // Rison treats `!` as its escape and `'` as its delimiter, so a hostile id
  // can neither close the string nor escape the href.
  test('escapes a rison quote in a trace id so it cannot close the query', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ traceId: "a'),b:(c" }))
    )

    expect(traceHref).toContain("query:'trace.id:%22a!')%2Cb%3A(c%22'))")
  })

  test('doubles a rison escape character in a trace id', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: 'a!f' }))).traceHref
    ).toContain('trace.id:%22a!!f%22')
  })

  test('carries the whole trace id for the link title', () => {
    givenLogsExplorer()

    expect(inboxModel().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('offers no logs link at all', () => {
    givenLogsExplorer()

    expect(model()).not.toHaveProperty('logsHref')
  })

  test('draws the instant the producer says it happened, on an inbox row', () => {
    const page = inboxModel()

    expect(page.occurred).toBe('2026-06-16T09:59:58Z')
    expect(page.occurredKnown).toBe(true)
    expect(page.messageGroup).toBeNull()
  })

  test('draws the FIFO group it was published in, on an outbox row', () => {
    const page = model()

    expect(page.messageGroup).toBe('GLD-9B2')
    expect(page.occurredKnown).toBe(false)
  })

  // A document that carries no time has no row to draw, rather than a dash.
  test('reports no occurrence for an inbox row that carries no time', () => {
    const page = inboxModel(found(inboxDetail({ occurredAt: null })))

    expect(page.occurred).toBe('—')
    expect(page.occurredKnown).toBe(false)
  })
})

/** Two attempts that failed the same way, which is the shape of a futile retry. */
const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    stack: null
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    stack: null
  }
]

const lastRedrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada Lovelace' }

describe('a dead letter with the park removed', () => {
  test('offers the redrive alone', () => {
    const page = model()

    expect(page.canRedrive).toBe(true)
    expect(page).not.toHaveProperty('canPark')
    expect(page).not.toHaveProperty('canUnpark')
    expect(page).not.toHaveProperty('parkAction')
    expect(page).not.toHaveProperty('unparkAction')
    expect(page).not.toHaveProperty('parkedFact')
  })

  test.each([['parked'], ['unparked'], ['park_conflict'], ['park_error']])(
    'has no banner left for the %s redirect',
    (param) => {
      expect(model(found(), { [param]: '1' }).banner).toBeNull()
    }
  )
})

describe('the futile redrive warning', () => {
  // Every part of the condition earns its place, so every part is asserted.
  test('warns when the last redrive produced the identical failure', () => {
    const page = model(
      found(detail({ attemptHistory: identicalAttempts, lastRedrive }))
    )

    expect(page.futileWarning).toBe(
      'A previous redrive (by Ada Lovelace, 2026-06-16T10:10:00Z) failed with the identical error — ' +
        'redriving again is unlikely to succeed until the underlying cause is fixed.'
    )
  })

  // A timeout and then a duplicate key is a system that changed its mind, and
  // another go is a perfectly reasonable thing to want.
  test('says nothing when the last two attempts failed differently', () => {
    const page = model(found(detail({ lastRedrive })))

    expect(page.futileWarning).toBeNull()
  })

  // Nobody has tried anything yet: two identical failures with no redrive on
  // record are just the poller doing its job.
  test('says nothing when nobody has redriven it', () => {
    const page = model(
      found(detail({ attemptHistory: identicalAttempts, lastRedrive: null }))
    )

    expect(page.futileWarning).toBeNull()
  })

  test('says nothing on one attempt, however it failed', () => {
    const page = model(
      found(detail({ attemptHistory: [identicalAttempts[0]], lastRedrive }))
    )

    expect(page.futileWarning).toBeNull()
  })

  test('says nothing when there is no attempt history at all', () => {
    const page = model(found(detail({ attemptHistory: [], lastRedrive })))

    expect(page.futileWarning).toBeNull()
  })

  test.each([
    ['COMPLETED', 'Completed'],
    ['RESUBMITTED', 'Resubmitted'],
    // A status this app has never seen, passed through as the endpoint wrote
    // it: still not a dead letter, so still nothing to warn about.
    ['PARKED', 'PARKED']
  ])('says nothing on a %s event', (status, label) => {
    const page = model(
      found(
        detail({
          ...stateOf(status, label),
          attemptHistory: identicalAttempts,
          lastRedrive
        })
      )
    )

    expect(page.futileWarning).toBeNull()
  })

  // Only the last two count: a message that failed three ways and then twice
  // the same way is still failing the same way.
  test('compares the last two attempts and not the ones before them', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:00:00.000Z',
              name: 'MongoNetworkTimeoutError',
              message: 'connection timed out',
              stack: null
            },
            ...identicalAttempts
          ],
          lastRedrive
        })
      )
    )

    expect(page.futileWarning).not.toBeNull()
  })
})

describe('the last redrive', () => {
  // Two parts, not one composed string: the card draws the instant in its
  // value register and the actor in the muted one beside it.
  test('says the instant absolutely, and who asked, as two values', () => {
    const page = model(found(detail({ lastRedrive })))

    expect(page.lastRedriveAt).toBe('2026-06-16T10:10:00Z')
    expect(page.lastRedriveAt).not.toContain('ago')
    expect(page.lastRedriveBy).toBe('Ada Lovelace')
  })

  test('says nothing on an event nobody has redriven', () => {
    expect(model().lastRedriveAt).toBeNull()
    expect(model().lastRedriveBy).toBeNull()
  })
})

describe('the shared failure link', () => {
  test('offers every other dead letter with this error, whole', () => {
    expect(model().errorSearchHref).toBe(
      '/dev-ops/events?status=DEAD_LETTER&error=E11000+duplicate+key'
    )
  })

  // The endpoint matches the message exactly, so the whole of it travels —
  // including the characters a query string is made of.
  test('escapes a message that would otherwise be a query of its own', () => {
    const page = model(
      found(
        detail({
          lastError: { name: 'Error', message: 'a&b=c #1', at: null }
        })
      )
    )

    expect(page.errorSearchHref).toBe(
      '/dev-ops/events?status=DEAD_LETTER&error=a%26b%3Dc+%231'
    )
  })

  test('is absent on an event with no failure recorded', () => {
    expect(model(found(detail({ lastError: null }))).errorSearchHref).toBeNull()
  })

  test.each([
    ['COMPLETED', 'Completed'],
    ['PARKED', 'PARKED']
  ])('is absent on a %s event', (status, label) => {
    expect(
      model(found(detail(stateOf(status, label)))).errorSearchHref
    ).toBeNull()
  })
})

describe('the journey table', () => {
  // A hop is timed from when THAT box took it — both measured by the box's
  // own clock, which is why they arrive stated rather than rebuilt here.
  test('says when each hop began and how long it itself took', () => {
    const page = model(
      found(detail(), [
        hop({ startedAt: '2026-06-16T10:00:01.000Z', took: '1.2s' })
      ])
    )

    expect(page.journey[0]).toMatchObject({
      createdAt: '2026-06-16T10:00:01Z',
      createdAtTitle: '2026-06-16T10:00:01.000Z',
      took: '1.2s'
    })
  })

  // A hop that has not completed has no duration, and a zero there would read
  // as an instant one.
  test('says nothing about a hop that has not completed', () => {
    const page = model(found(detail(), [hop({ took: null })]))

    expect(page.journey[0].took).toBe('—')
  })

  test('draws a dash rather than throwing on a start it cannot read', () => {
    const page = model(found(detail(), [hop({ startedAt: 'never' })]))

    expect(page.journey[0].createdAt).toBe('—')
    expect(page.journey[0].createdAtTitle).toBe('')
  })
})

/**
 * The one cell two surfaces state. The same wire row goes through both models
 * and the two cells are compared with each other rather than each against a
 * literal — a pair of literals would agree until somebody changed one.
 *
 * The WORDS are what both surfaces owe each other. The link is not: this page
 * hangs one on its Queue fact and the list draws the same words as plain text,
 * a deliberate difference asserted on each side rather than shared here.
 */
interface QueueCell {
  hop: string
  queue: string | null
  queueValue: string | null
}

const cellOf = ({ hop, queue, queueValue }: QueueCell): QueueCell => ({
  hop,
  queue,
  queueValue
})

/** The list, rendered with one row on it and no filters at all. */
const listCell = (event: EventRow): QueueCell =>
  cellOf(
    toEventsPage(
      {
        page: {
          events: [event],
          pagination: {
            startCursor: null,
            endCursor: null,
            hasNextPage: false,
            hasPreviousPage: false
          },
          sourceErrors: []
        },
        statuses: [],
        services,
        facets: null,
        breakdown: null,
        unavailable: false
      },
      {},
      now
    ).rows[0]
  )

/** The same row as the list receives it: the detail's fields plus latency. */
const row = (overrides: Partial<EventRow> = {}): EventRow => ({
  ...base,
  latency: null,
  latencyTitle: 'Queued to delivered to SNS',
  ...overrides
})

describe('the Queue cell, on the list and on this page', () => {
  test.each([
    ['a domain outbox row', {}],
    [
      'an audit outbox row',
      { queue: 'to Audit', queueValue: 'gas__sns__audit_topic_arn' }
    ],
    [
      'an outbox row nothing subscribes to',
      { queue: 'to case_created', queueValue: 'cw__sns__case_created' }
    ],
    ['an outbox row with no target at all', { queue: null, queueValue: null }],
    [
      'an inbox row',
      {
        box: 'inbox' as const,
        hop: 'GAS Inbox',
        queue: 'from Caseworking',
        queueValue: null
      }
    ],
    [
      'a hop this page cannot filter to',
      {
        service: 'reporting' as unknown as 'gas',
        hop: 'reporting Outbox'
      }
    ]
  ])('says the same thing about %s on both', (_name, overrides) => {
    const fact = cellOf(model(found(detail(overrides))))

    expect(fact).toEqual(listCell(row(overrides)))
    // Guards the comparison itself: two empty cells would also be equal.
    expect(fact.hop).not.toBe('')
  })

  // Neither surface links the hop any more: narrowing the list to a service
  // is the toolbar's job on the list, and this page has no list to narrow.
  // The journey table's own links are a different thing and stay - they are
  // row navigation, each one to that hop's own page.
  test('hangs no link on the hop, on either surface', () => {
    const page = model()

    expect(page).not.toHaveProperty('hopHref')
    expect(page).not.toHaveProperty('hopTitle')
    expect(listCell(row())).not.toHaveProperty('hopHref')
  })

  test('draws a hop the toolbar has no chip for as the words it was sent', () => {
    const page = model(
      found(
        detail({
          service: 'reporting' as unknown as 'gas',
          hop: 'reporting Outbox'
        })
      )
    )

    expect(page.hop).toBe('reporting Outbox')
  })
})
