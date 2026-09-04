import { config } from '../../common/config.ts'
import type {
  Event,
  EventDetail,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import { toEventPage, toSafeFrom } from './event-page.view-model.ts'

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
const key = { service: 'gas', box: 'outbox', id }

const row = (overrides: Partial<Event> = {}): Event => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  source: null,
  target: 'gas__sns__update_case_status_fifo',
  segregationRef: 'GLD-9B2-BWS-grasslands',
  status: 'DEAD_LETTER',
  attempts: 5,
  maxAttempts: 5,
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  completedAt: null,
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    at: '2026-06-16T10:16:05.000Z'
  },
  ...overrides
})

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  ...row(),
  attemptHistory: [
    {
      at: '2026-06-16T10:08:00.000Z',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms'
    },
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events index: id_1'
    }
  ],
  payload: { data: { caseRef: 'GLD-9B2' } },
  targetRaw:
    'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo',
  messageId: 'a0e1b2c3-4444-5555-6666-777788889999',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: null,
  claimExpiresAt: null,
  lastRedrive: null,
  ...overrides
})

const found = (
  event: EventDetail = detail(),
  journey: Event[] = [row()]
): EventResult => ({ outcome: 'found', event, journey })

const model = (
  result: EventResult = found(),
  query: Parameters<typeof toEventPage>[2] = {}
) => toEventPage(result, key, query, now)

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

  test('names the event and the state it is in', () => {
    const page = model()

    expect(page.type).toBe('case.status.updated')
    expect(page.typeTitle).toBe(
      'cloud.defra.prd.fg-gas-backend.case.update.status'
    )
    expect(page.statusLabel).toBe('Dead letter')
    expect(page.statusRole).toBe('error')
    expect(page.attempts).toBe('5/5')
    expect(page.attemptsAtMax).toBe(true)
  })

  test('hangs no title off a type the endpoint spells the same way', () => {
    expect(
      model(found(detail({ fullType: 'case.status.updated' }))).typeTitle
    ).toBeNull()
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
    expect(page.completionDate).toBe('—')
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
        row(),
        row({
          id: '111111111111111111111111',
          service: 'caseworking',
          box: 'inbox'
        })
      ])
    )

    expect(page.journey.map((hop) => hop.source)).toEqual([
      'GAS · Outbox',
      'CW · Inbox'
    ])
    expect(page.journey.map((hop) => hop.href)).toEqual([
      `/dev-ops/events/gas/outbox/${id}`,
      '/dev-ops/events/caseworking/inbox/111111111111111111111111'
    ])
    expect(page.journeyCount).toBe(2)
  })

  test('marks the hop the page is already about', () => {
    const page = model(
      found(detail(), [row(), row({ id: '111111111111111111111111' })])
    )

    expect(page.journey.map((hop) => hop.isCurrent)).toEqual([true, false])
  })

  // Same id, same box, different service: not the same row.
  test('marks no hop that only half matches this address', () => {
    const page = model(found(detail(), [row({ service: 'caseworking' })]))

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
    expect(model(found(detail({ status: 'FAILED' }))).canRedrive).toBe(false)
  })

  test('confirms a redrive only when it is asked for and allowed', () => {
    expect(model(found(), { confirm: 'redrive' }).confirmRedrive).toBe(true)
    expect(model().confirmRedrive).toBe(false)
    expect(
      model(found(detail({ status: 'COMPLETED' })), { confirm: 'redrive' })
        .confirmRedrive
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

  test('names the status a conflict reported, as a human says it', () => {
    const banner = model(found(), { redrive_conflict: 'COMPLETED' }).banner

    expect(banner?.role).toBe('warning')
    expect(banner?.message).toContain('Its status is now Completed.')
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

  // The page said `attempts 5/5` and then, on one line, why the last of them
  // failed — the story of the fifth attempt told as the story of the event.
  test('lists every attempt, oldest first and numbered as it happened', () => {
    const { attemptHistory, attemptCount } = model()

    expect(attemptCount).toBe(2)
    expect(attemptHistory.map(({ number }) => number)).toEqual(['#1', '#2'])
    expect(attemptHistory[0]).toEqual({
      number: '#1',
      absolute: '2026-06-16T10:08:00.000Z',
      delta: 'after 8m 0s',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms',
      title:
        '2026-06-16T10:08:00Z   ·   16 Jun 2026, 11:08:00 BST (Europe/London)'
    })
  })

  // A relative time is the one spelling this line cannot use. Five attempts
  // inside one minute are five identical phrases — and the timeline is read
  // precisely in that case, which is why the instant is drawn whole and the
  // gap in front of it is drawn beside it.
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

  // The whole reason the timeline exists. Four attempts inside a second is a
  // service retrying into a wall, and nothing in a column of timestamps says
  // so until something subtracts them — least of all at a resolution that
  // rounds all four to `12m ago`.
  test('makes a missing backoff visible as four sub-second deltas', () => {
    const { attemptHistory } = model(
      found(
        detail({
          createdAt: '2026-06-16T10:08:00.000Z',
          attemptHistory: [
            { at: '2026-06-16T10:08:00.120Z', name: 'E', message: 'boom' },
            { at: '2026-06-16T10:08:00.393Z', name: 'E', message: 'boom' },
            { at: '2026-06-16T10:08:00.905Z', name: 'E', message: 'boom' },
            { at: '2026-06-16T10:08:02.005Z', name: 'E', message: 'boom' }
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
          attemptHistory: [
            { at: '2026-06-16T04:00:30.000Z', name: 'E', message: 'boom' },
            { at: '2026-06-16T04:02:30.000Z', name: 'E', message: 'boom' },
            { at: '2026-06-16T09:36:30.000Z', name: 'E', message: 'boom' }
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
            { at: 'not a date', name: 'E', message: 'boom' },
            { at: 'nor this', name: 'E', message: 'boom' }
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
    const { attemptHistory, attemptCount } = model(
      found(detail({ attemptHistory: [] }))
    )

    expect(attemptHistory).toEqual([])
    expect(attemptCount).toBe(0)
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
            status: 'COMPLETED',
            completionDate: '2026-06-16T10:17:00.000Z'
          })
        )
      ).attemptOutcome
    ).toBe('completed at 2026-06-16T10:17:00Z')
  })

  test('falls back to the list row completion when no completion date is set', () => {
    expect(
      model(
        found(
          detail({
            status: 'COMPLETED',
            completionDate: null,
            completedAt: '2026-06-16T10:18:00.000Z'
          })
        )
      ).attemptOutcome
    ).toBe('completed at 2026-06-16T10:18:00Z')
  })

  test('ends nothing on an event that is still in play', () => {
    expect(
      model(found(detail({ status: 'PROCESSING' }))).attemptOutcome
    ).toBeNull()
  })

  // The trace link is the detail page's one way out into the logs, and the
  // only place in the app that builds a Discover href at all now: the list
  // rows carry no such link, and the by-event-id `logs` link is gone.
  test('links the trace at plain Discover on the shared index pattern', () => {
    givenLogsExplorer()

    const { traceHref } = model()

    expect(traceHref).toBe(
      `${logsBase}/_dashboards/app/data-explorer/discover/#` +
        `?_a=(discover:(columns:!(container_name,message,log.level,trace.id),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:e55f3890-5d4a-11ee-8f40-670c9b0b8093,view:discover))` +
        `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-06-16T04:00:00.000Z',to:'2026-06-16T16:00:00.000Z'))` +
        `&_q=(filters:!(),query:(language:kuery,query:'trace.id:%224bf92f3577b34da6a3ce929d0e0e4736%22'))`
    )
  })

  // Six hours either side of the event, so a trace that started before it and
  // finished after it is inside the window.
  test('windows the search six hours either side of the event', () => {
    givenLogsExplorer()

    const { traceHref } = model(
      found(detail({ createdAt: '2026-06-16T13:30:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-16T07:30:00.000Z'")
    expect(traceHref).toContain("to:'2026-06-16T19:30:00.000Z')")
  })

  test('windows across a date boundary without losing the day', () => {
    givenLogsExplorer()

    const { traceHref } = model(
      found(detail({ createdAt: '2026-06-16T02:00:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-15T20:00:00.000Z'")
  })

  test('links nothing on a row with no trace at all', () => {
    givenLogsExplorer()

    expect(model(found(detail({ traceId: null }))).traceHref).toBeNull()
  })

  test('links nothing when no logs explorer is configured', () => {
    expect(model().traceHref).toBeNull()
  })

  test('links nothing when the configured base url is blank', () => {
    givenLogsExplorer('')

    expect(model().traceHref).toBeNull()
  })

  test('links nothing when the row has an unparseable created time', () => {
    givenLogsExplorer()

    expect(
      model(found(detail({ createdAt: 'not-a-date' }))).traceHref
    ).toBeNull()
  })

  test('keeps a bare CDP request id as the trace id', () => {
    givenLogsExplorer()

    expect(
      model(found(detail({ traceId: 'cdp-request-id-1' }))).traceHref
    ).toContain("query:'trace.id:%22cdp-request-id-1%22'")
  })

  test('url-encodes a trace id that would otherwise escape the href', () => {
    givenLogsExplorer()

    const { traceHref } = model(
      found(detail({ traceId: '" onmouseover=alert(1) x="' }))
    )

    expect(traceHref).not.toContain('"')
    expect(traceHref).not.toContain(' ')
  })

  // Rison treats `!` as its escape and `'` as its delimiter, so a hostile id
  // can neither close the string nor escape the href.
  test("escapes a trace id's rison quote so it cannot close the query", () => {
    givenLogsExplorer()

    const { traceHref } = model(found(detail({ traceId: "a'),b:(c" })))

    expect(traceHref).toContain("query:'trace.id:%22a!')%2Cb%3A(c%22'))")
  })

  test('doubles a rison escape character in a trace id', () => {
    givenLogsExplorer()

    expect(model(found(detail({ traceId: 'a!f' }))).traceHref).toContain(
      'trace.id:%22a!!f%22'
    )
  })

  // The whole trace id is the link's title.
  test('carries the whole trace id for the link title', () => {
    givenLogsExplorer()

    expect(model().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  // The by-event-id `logs` link is gone: the detail page offers the trace and
  // nothing else, and there is no `logsHref` on the model any more.
  test('offers no logs link at all', () => {
    givenLogsExplorer()

    expect(model()).not.toHaveProperty('logsHref')
  })
})

/** Two attempts that failed the same way, which is the shape of a futile retry. */
const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events'
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events'
  }
]

const lastRedrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada Lovelace' }

// The PARKED state and both of its verbs are gone: a dead letter's only
// decision is the redrive, and nothing on the page mentions parking.
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

  test.each([['COMPLETED'], ['RESUBMITTED'], ['PARKED']])(
    'says nothing on a %s event',
    (status) => {
      const page = model(
        found(
          detail({ status, attemptHistory: identicalAttempts, lastRedrive })
        )
      )

      expect(page.futileWarning).toBeNull()
    }
  )

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
              message: 'connection timed out'
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
  test('says the instant absolutely, and who asked', () => {
    const page = model(found(detail({ lastRedrive })))

    expect(page.lastRedriveFact).toBe('2026-06-16T10:10:00Z · by Ada Lovelace')
    expect(page.lastRedriveFact).not.toContain('ago')
    expect(page.lastRedriveTitle).toBe('2026-06-16T10:10:00Z')
  })

  test('says nothing on an event nobody has redriven', () => {
    expect(model().lastRedriveFact).toBeNull()
    expect(model().lastRedriveTitle).toBe('')
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

  test.each([['COMPLETED'], ['PARKED']])(
    'is absent on a %s event',
    (status) => {
      expect(model(found(detail({ status }))).errorSearchHref).toBeNull()
    }
  )
})

describe('the journey table', () => {
  test('says how long each hop itself took', () => {
    const page = model(
      found(detail(), [
        row({
          createdAt: '2026-06-16T10:00:00.000Z',
          completedAt: '2026-06-16T10:00:01.200Z'
        })
      ])
    )

    expect(page.journey[0].took).toBe('1.2s')
  })

  // A hop that has not completed has no duration, and a zero there would read
  // as an instant one.
  test('says nothing about a hop that has not completed', () => {
    const page = model(found(detail(), [row({ completedAt: null })]))

    expect(page.journey[0].took).toBe('—')
  })
})
