import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  Event,
  EventDetail,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'

vi.mock(import('../use-cases/get-event.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`

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
  traceId,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  completedAt: null,
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events index: id_1',
    at: '2026-06-16T10:16:05.000Z'
  },
  parked: null,
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
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
  targetRaw:
    'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo',
  messageId: 'a0e1b2c3-4444-5555-6666-777788889999',
  traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: '2026-06-16T10:16:00.000Z',
  claimExpiresAt: '2026-06-16T10:21:00.000Z',
  lastRedrive: null,
  ...overrides
})

const givenEvent = (
  event: EventDetail = detail(),
  journey: Event[] = [row()]
) =>
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'found',
    event,
    journey
  } as EventResult)

const givenOutcome = (outcome: 'not-found' | 'unavailable') =>
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome,
    event: null,
    journey: []
  } as EventResult)

const xss = '<script>alert(1)</script>'

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const viewPage = async (url = path) => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

const valueOf = ($: CheerioAPI, testId: string) =>
  flatten($(`[data-testid="${testId}"]`).text())

let server: Server

const now = new Date('2026-06-16T10:20:00.000Z')

/** An event an operator set aside, as the endpoint reports the park. */
const parkedNote = {
  at: '2026-06-16T10:10:00.000Z',
  reason: 'duplicate key on a case that no longer exists',
  by: 'Ada Lovelace'
}

/** Two attempts that failed the same way — the shape of a futile retry. */
const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key'
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key'
  }
]

const lastRedrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada Lovelace' }

describe('viewEventRoute', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)

    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenEvent()
  })

  afterAll(async () => {
    vi.useRealTimers()
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: path
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: path,
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

  test('renders the page for the operations admin role', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-header"]')).toHaveLength(1)
  })

  test('asks the use case for the event at this address', async () => {
    await viewPage()

    expect(getEventUseCase).toHaveBeenCalledTimes(1)
    expect(getEventUseCase).toHaveBeenCalledWith({
      service: 'gas',
      box: 'outbox',
      id
    })
  })

  // A path is not a filter. A service outside the two is not a query the
  // endpoint might one day accept, it is a url nobody ever issued.
  test.each([
    ['a service it does not know', `/dev-ops/events/other/outbox/${id}`],
    ['a box it does not know', `/dev-ops/events/gas/sideways/${id}`],
    ['an id that is not an object id', '/dev-ops/events/gas/outbox/nope'],
    ['an id of the wrong length', `/dev-ops/events/gas/outbox/${id}00`],
    ['an id carrying markup', '/dev-ops/events/gas/outbox/%3Cscript%3E']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventUseCase).not.toHaveBeenCalled()
  })

  test('accepts a caseworking inbox address', async () => {
    const { statusCode } = await viewPage(
      `/dev-ops/events/caseworking/inbox/${id}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventUseCase).toHaveBeenCalledWith({
      service: 'caseworking',
      box: 'inbox',
      id
    })
  })

  test('titles the tab with the event type', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toContain('case.status.updated |')
  })

  // ── The header ────────────────────────────────────────────────────────────

  // The id heads the page: it is the one identifier every event has — an audit
  // record publishes no CloudEvent type — and it is the string the operator
  // came here to copy. The type follows underneath, with the un-stripped
  // CloudEvent type on its title.
  // Every instant this page draws is UTC, so it says so nowhere. Swept whole,
  // attributes included, because a title is visible too: the four poller dates,
  // the journey table, the attempt history and the confirm panels all state
  // instants, and none of them wears a zone.
  test('writes no UTC label anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('UTC')
  })

  test('writes none on the confirm panels either', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('main').html()).not.toContain('UTC')
  })

  test('heads the page with the event id, at h1 size', async () => {
    const { $ } = await viewPage()

    const title = $('[data-testid="event-title"]')

    expect(title.is('h1')).toBe(true)
    expect(title.text().trim()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(title.attr('class')).toContain('text-xl')
    expect(title.attr('class')).toContain('font-mono')
  })

  test('sets the type under the id, with the full type on its title', async () => {
    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect(type.text().trim()).toBe('case.status.updated')
    expect(type.attr('title')).toBe(
      'cloud.defra.prd.fg-gas-backend.case.update.status'
    )
  })

  // An audit record publishes no type. The id heads the page regardless, so
  // there is nothing to stand in for: the type line is simply not drawn.
  test('heads a null-typed event with its id, and draws no type line', async () => {
    givenEvent(detail({ type: null, fullType: null }))

    const { $ } = await viewPage()

    const title = $('[data-testid="event-title"]')

    expect(title.is('h1')).toBe(true)
    expect(title.text().trim()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect($('[data-testid="event-type"]')).toHaveLength(0)
    expect($('[data-testid="event-header"]').text()).not.toContain('n/a')
  })

  test('says the status as a dot and a word, as the list does', async () => {
    const { $ } = await viewPage()

    const badge = $(
      '[data-testid="event-header"] [data-testid="do-status-badge"]'
    )

    expect(badge).toHaveLength(1)
    expect(badge.attr('title')).toBe('DEAD_LETTER')
    expect(badge.find('[data-testid="do-status-label"]').text()).toBe(
      'Dead letter'
    )
  })

  test('carries the attempts and the failure under the status', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts')).toBe('5/5')
    expect(valueOf($, 'event-last-failure')).toBe('2026-06-16T10:16:05Z')
    expect($('[data-testid="event-failure"]').attr('title')).toContain(
      '2026-06-16T10:16:05Z'
    )
  })

  test('says nothing about attempts on a first-attempt event', async () => {
    givenEvent(
      detail({
        ...row({ status: 'PUBLISHED', attempts: 1, lastFailureAt: null }),
        lastError: null
      } as Partial<EventDetail>)
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
  })

  // This is the page an operator came to in order to copy the id, so it is
  // whole and the button beside it is drawn at all times rather than on hover.
  // It sits beside the heading, which IS the id: the page used to head itself
  // with the type and then repeat the id as a token two lines below.
  test('shows the whole event id once, with an always-visible copy button', async () => {
    const { $ } = await viewPage()

    const copy = $(
      '[data-testid="event-header"] [data-testid="do-copy-button"]'
    )

    expect($('[data-testid="event-title"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
    expect(copy).toHaveLength(1)
    expect(copy.attr('value')).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(copy.find('button').attr('class')).toContain('opacity-70')
    expect(copy.find('button').attr('class')).not.toContain('opacity-0')
  })

  // One copy of the id in the header, not two: it used to appear as a token
  // under an h1 that named the type, and promoting it made that a repetition.
  test('does not print the same id twice in the header', async () => {
    const { $ } = await viewPage()

    const header = $('[data-testid="event-header"]').text()
    const id = '3f2c1a0e-1111-2222-3333-444455556666'

    expect(header.split(id)).toHaveLength(2)
  })

  // ── The facts ─────────────────────────────────────────────────────────────

  test('reads the route as the list does, with the whole ARN beneath it', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-route')).toBe('GAS → Caseworking')
    expect(valueOf($, 'event-target-raw')).toBe(
      'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo'
    )
    expect(
      $('[data-testid="event-fact-route"] [data-testid="do-copy-button"]').attr(
        'value'
      )
    ).toBe(
      'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo'
    )
  })

  // The consumer map lives in the shared formats, so the inspect page reads
  // every route the list does without knowing a topic from a queue.
  test('reads an audit topic as bound for Audit, as the list does', async () => {
    givenEvent(detail({ target: 'gas__sns__audit_topic_arn' }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-route')).toBe('GAS → Audit')
  })

  test('links the reference at every event about the same thing', async () => {
    const { $ } = await viewPage()

    const ref = $('[data-testid="event-segregation-ref"]')

    expect(ref.is('a')).toBe(true)
    expect(ref.attr('href')).toBe('/dev-ops/events?q=GLD-9B2-BWS-grasslands')
    expect(ref.text()).toBe('GLD-9B2-BWS-grasslands')
    expect(
      $(
        '[data-testid="event-fact-reference"] [data-testid="do-copy-button"]'
      ).attr('value')
    ).toBe('GLD-9B2-BWS-grasslands')
  })

  test('shows the message id with a copy button', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-message-id')).toBe(
      'a0e1b2c3-4444-5555-6666-777788889999'
    )
    expect(
      $(
        '[data-testid="event-fact-message-id"] [data-testid="do-copy-button"]'
      ).attr('value')
    ).toBe('a0e1b2c3-4444-5555-6666-777788889999')
  })

  // The value is the door: the traceparent itself opens Discover on this
  // trace in a new tab, with no copy button and no separate link beside it.
  test('shows the traceparent in mono, as the explorer link itself', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    const traceparent = $('a[data-testid="event-traceparent"]')

    expect(traceparent.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
    expect(traceparent.attr('class')).toContain('font-mono')
    expect(traceparent.attr('href')).toContain(logsBase)
    expect(traceparent.attr('href')).toContain(traceId)
    expect(traceparent.attr('target')).toBe('_blank')
    expect(traceparent.attr('rel')).toBe('noopener noreferrer')
    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
    expect(
      $('[data-testid="event-fact-traceparent"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
  })

  test('draws no explorer link when the event carries no trace', async () => {
    givenLogsExplorer()
    givenEvent(detail({ ...row({ traceId: null }), traceparent: null }))

    const { $ } = await viewPage()

    expect($('a[data-testid="event-traceparent"]')).toHaveLength(0)
    expect($('[data-testid="event-traceparent-none"]').text()).toBe('—')
  })

  // Still readable and selectable, just not a door: with no explorer
  // configured there is nowhere for the value to lead.
  test('leaves the traceparent plain text when no explorer is configured', async () => {
    const { $ } = await viewPage()

    const traceparent = $('[data-testid="event-traceparent"]')

    expect(traceparent).toHaveLength(1)
    expect(traceparent.is('a')).toBe(false)
    expect(traceparent.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
  })

  // Created states the instant once and absolutely: the ISO UTC value that
  // gets pasted into a log query, with the button that carries it. No
  // relative time and no London spelling — one goes stale in an open tab,
  // the other cannot be quoted.
  test('says when the event was created, absolutely and only absolutely', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-created-absolute')).toBe('2026-06-16T10:00:00Z')
    expect($('[data-testid="event-created-relative"]')).toHaveLength(0)
    expect($('[data-testid="event-created-london"]')).toHaveLength(0)
    expect(
      $(
        '[data-testid="event-fact-created"] [data-testid="do-copy-button"]'
      ).attr('value')
    ).toBe('2026-06-16T10:00:00Z')
  })

  // Every timestamp row states the instant and only the instant. A relative
  // time cannot be quoted, cannot be pasted into a log query and goes stale
  // in an open tab, so no row on this page carries one.
  test('states every timestamp absolutely, never how long ago', async () => {
    givenEvent(
      detail({
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z',
        parked: parkedNote,
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    const rows = [
      'event-fact-publication',
      'event-fact-completion',
      'event-fact-last-resubmission',
      'event-fact-claimed-at',
      'event-fact-claim-expires',
      'event-fact-parked',
      'event-fact-last-error',
      'event-fact-created',
      'event-fact-last-redrive'
    ]

    rows.forEach((testId) => {
      expect(valueOf($, testId)).not.toContain('ago')
    })
  })

  // What an operator does with a timestamp on this page is take it somewhere
  // else, so every row that states one carries the button that carries it.
  test('offers a copy button beside every timestamp it states', async () => {
    givenEvent(
      detail({
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z',
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    const copied = (testId: string) =>
      $(`[data-testid="${testId}"] [data-testid="do-copy-button"]`).attr(
        'value'
      )

    expect(copied('event-fact-created')).toBe('2026-06-16T10:00:00Z')
    expect(copied('event-fact-publication')).toBe('2026-06-16T10:00:01Z')
    expect(copied('event-fact-completion')).toBe('2026-06-16T10:17:00Z')
    expect(copied('event-fact-last-resubmission')).toBe('2026-06-16T10:16:30Z')
    expect(copied('event-fact-claimed-at')).toBe('2026-06-16T10:16:00Z')
    expect(copied('event-fact-claim-expires')).toBe('2026-06-16T10:21:00Z')
    expect(copied('event-fact-last-redrive')).toBe('2026-06-16T10:15:00.000Z')
    expect(copied('event-fact-last-error')).toBe('2026-06-16T10:16:05Z')
  })

  // Never beside a dash: a button offering to copy `—` is a button that can
  // only ever put a placeholder on somebody's clipboard.
  test('offers no copy button beside a date the event does not carry', async () => {
    givenEvent(
      detail({
        publicationDate: null,
        completionDate: null,
        lastResubmissionDate: null,
        claimedAt: null,
        claimExpiresAt: null
      })
    )

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-fact-publication"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
    expect(
      $('[data-testid="event-fact-completion"] [data-testid="do-copy-button"]')
    ).toHaveLength(0)
  })

  test('states the poller dates absolutely', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-fact-publication-value')).toBe(
      '2026-06-16T10:00:01Z'
    )
    expect(valueOf($, 'event-fact-claimed-at-value')).toBe(
      '2026-06-16T10:16:00Z'
    )
    expect(valueOf($, 'event-fact-claim-expires-value')).toBe(
      '2026-06-16T10:21:00Z'
    )
  })

  test('draws a dash for every date the event does not carry', async () => {
    givenEvent(
      detail({
        publicationDate: null,
        completionDate: null,
        lastResubmissionDate: null,
        claimedAt: null,
        claimExpiresAt: null
      })
    )

    const { $ } = await viewPage()

    const dates = [
      'event-fact-publication-value',
      'event-fact-completion-value',
      'event-fact-last-resubmission-value',
      'event-fact-claimed-at-value',
      'event-fact-claim-expires-value'
    ]

    dates.forEach((testId) => {
      expect(valueOf($, testId)).toBe('—')
    })
  })

  test('states the attempts against their maximum', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-value')).toBe('5/5')
  })

  // The list cuts the reason to 64 characters; a truncated one is the single
  // commonest reason an operator opens this page at all.
  test('says the whole failure reason, wrapped, in the error colour', async () => {
    const { $ } = await viewPage()

    const message = $('[data-testid="event-error-message"]')

    expect(flatten(message.text())).toBe(
      'MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
    )
    expect(message.attr('class')).toContain('text-error')
    expect(message.attr('class')).not.toContain('truncate')
    expect(valueOf($, 'event-error-name')).toBe('MongoServerError')
    expect(valueOf($, 'event-error-at')).toBe('at 2026-06-16T10:16:05Z')
  })

  test('draws a dash where the event never failed', async () => {
    givenEvent(detail({ lastError: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-none"]').text()).toBe('—')
    expect($('[data-testid="event-error-message"]')).toHaveLength(0)
  })

  test('draws a dash for a reference and a message id the event has not got', async () => {
    givenEvent(detail({ segregationRef: null, messageId: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref-none"]').text()).toBe('—')
    expect($('[data-testid="event-message-id-none"]').text()).toBe('—')
    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  // ── The payload ───────────────────────────────────────────────────────────

  test('prints the payload as pretty json inside a pre', async () => {
    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')

    expect(payload.is('pre')).toBe(true)
    expect(payload.find('code')).toHaveLength(1)
    expect(payload.text()).toBe(
      JSON.stringify(
        { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
        null,
        2
      )
    )
    expect(payload.attr('class')).toContain('do-payload')
  })

  test('offers a copy button for the raw payload json', async () => {
    const { $ } = await viewPage()

    const copy = $(
      '[data-testid="event-payload-card"] [data-testid="do-copy-button"]'
    )

    expect(copy.attr('value')).toBe(
      JSON.stringify(
        { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
        null,
        2
      )
    )
  })

  // The whole point of the section, and the whole risk of it: whatever was
  // published is rendered as text, never as markup this page would run.
  test('renders a payload carrying a script tag as text', async () => {
    givenEvent(detail({ payload: { note: xss } }))

    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')

    expect(payload.find('script')).toHaveLength(0)
    expect(payload.text()).toContain(xss)
    expect($('script')).toHaveLength(1)
  })

  test('renders a payload key carrying markup as text', async () => {
    givenEvent(detail({ payload: { [xss]: 'value' } }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-payload"]').find('script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
  })

  test('says so when the event carries no payload at all', async () => {
    givenEvent(detail({ payload: undefined }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-payload"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-empty"]').text()).toContain(
      'no payload'
    )
  })

  // ── The journey ───────────────────────────────────────────────────────────

  test('names the journey for what it is', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-journey-heading')).toBe(
      'Journey — every hop with this event id'
    )
  })

  test('renders a row for every hop the use case returned', async () => {
    givenEvent(detail(), [
      row(),
      row({
        id: '111111111111111111111111',
        box: 'inbox',
        service: 'caseworking',
        status: 'COMPLETED'
      })
    ])

    const { $ } = await viewPage()

    const rows = $('[data-testid="event-journey-row"]')

    expect(rows).toHaveLength(2)
    expect(
      $('[data-testid="event-journey-link"]')
        .toArray()
        .map((link) => $(link).text().trim())
    ).toEqual(['GAS · Outbox', 'CW · Inbox'])
  })

  test('links every hop at its own page', async () => {
    givenEvent(detail(), [
      row(),
      row({ id: '111111111111111111111111', box: 'inbox' })
    ])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-journey-link"]')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual([
      `/dev-ops/events/gas/outbox/${id}`,
      '/dev-ops/events/gas/inbox/111111111111111111111111'
    ])
  })

  // Marked, not unlinked: a table where one row has no link reads as broken.
  test('marks the hop the operator is already on', async () => {
    givenEvent(detail(), [
      row(),
      row({ id: '111111111111111111111111', box: 'inbox' })
    ])

    const { $ } = await viewPage()

    const rows = $('[data-testid="event-journey-row"]')

    expect(rows.first().hasClass('do-journey-current')).toBe(true)
    expect(rows.last().hasClass('do-journey-current')).toBe(false)
    expect($('[data-testid="event-journey-current"]')).toHaveLength(1)
    expect(valueOf($, 'event-journey-current')).toBe('this event')
  })

  test('states each hop status and the instant it was created', async () => {
    const { $ } = await viewPage()

    const cell = $('[data-testid="event-journey-row"]').first()

    expect(cell.find('[data-testid="do-status-label"]').text()).toBe(
      'Dead letter'
    )
    expect(valueOf($, 'event-journey-created')).toBe('2026-06-16T10:00:00Z')
  })

  // One hop is still a journey: the table says the event exists in one queue
  // and nowhere else, which is a fact worth reading.
  test('renders the table for a journey of one', async () => {
    givenEvent(detail(), [row()])

    const { $ } = await viewPage()

    expect($('[data-testid="event-journey"]')).toHaveLength(1)
    expect($('[data-testid="event-journey-row"]')).toHaveLength(1)
  })

  test('says so when the journey could not be read at all', async () => {
    givenEvent(detail(), [])

    const { $ } = await viewPage()

    expect($('[data-testid="event-journey"]')).toHaveLength(0)
    expect($('[data-testid="event-journey-empty"]')).toHaveLength(1)
  })

  // ── The way back ──────────────────────────────────────────────────────────

  test('links back to the plain list when the page was opened cold', async () => {
    const { $ } = await viewPage()

    const back = $('[data-testid="event-back"]')

    expect(back.attr('href')).toBe('/dev-ops/events')
    expect(back.text().trim()).toBe('← Events')
  })

  test('puts the operator back on the list they left', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER&cursor=END')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&cursor=END'
    )
  })

  // The two shapes that turn `/dev-ops/events` plus a suffix into a link
  // somewhere else, and the one that is simply not a query string.
  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com/phish'],
    ['a path that is not a query', '/dev-ops/events?status=FAILED'],
    ['a query hiding a protocol-relative url', '?a=b//example.com'],
    ['an empty value', '']
  ])('drops %s from the back link', async (_name, from) => {
    const { statusCode, $ } = await viewPage(
      `${path}?from=${encodeURIComponent(from)}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
  })

  test('carries the same from onto every journey link', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER')}`
    )

    expect($('[data-testid="event-journey-link"]').first().attr('href')).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER`
    )
  })

  // ── Redrive ───────────────────────────────────────────────────────────────

  test('offers a redrive on a dead-lettered event', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="event-redrive"]')

    expect(button.is('a')).toBe(true)
    expect(button.attr('href')).toBe(`${path}?confirm=redrive`)
    expect(button.attr('class')).toBe('btn btn-sm btn-error btn-outline')
    expect(button.text().trim()).toBe('Redrive')
  })

  test.each(['PUBLISHED', 'PROCESSING', 'FAILED', 'RESUBMITTED', 'COMPLETED'])(
    'offers no redrive on a %s event',
    async (status) => {
      givenEvent(detail({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-redrive"]')).toHaveLength(0)
      expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(0)
    }
  )

  test('ignores a confirmation asked for on an event that cannot be redriven', async () => {
    givenEvent(detail({ status: 'COMPLETED' }))

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive-form"]')).toHaveLength(0)
  })

  test('asks before it writes, and says what the write does', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-question')).toBe(
      'Redrive this event? It will be retried up to 5 times by the poller. This action is audited.'
    )
    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
  })

  test('posts the confirmation at the redrive route', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    const form = $('[data-testid="event-redrive-form"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${path}/redrive`)
    expect($('[data-testid="event-redrive-submit"]').attr('type')).toBe(
      'submit'
    )
  })

  test('carries the list query through the confirmation', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER')}&confirm=redrive`
    )

    const hidden = $('[data-testid="event-redrive-from"]')

    expect(hidden.attr('name')).toBe('from')
    expect(hidden.attr('value')).toBe('?status=DEAD_LETTER')
    expect($('[data-testid="event-redrive-cancel"]').attr('href')).toBe(
      `${path}?from=%3Fstatus%3DDEAD_LETTER`
    )
  })

  test('cancels back to the page without the confirmation on it', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-cancel"]').attr('href')).toBe(path)
  })

  test('carries a hostile from no further than the form', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('//example.com')}&confirm=redrive`
    )

    expect($('[data-testid="event-redrive-from"]').attr('value')).toBe('')
  })

  // ── The banners a redirect leaves behind ──────────────────────────────────

  test('says a redrive was requested', async () => {
    const { $ } = await viewPage(`${path}?redriven=1`)

    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-success')
    expect(flatten(banner.text())).toBe(
      'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
    )
  })

  test('names the status that refused a redrive', async () => {
    const { $ } = await viewPage(`${path}?redrive_conflict=RESUBMITTED`)

    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-warning')
    expect(flatten(banner.text())).toContain('Its status is now Resubmitted.')
  })

  test('keeps the endpoint spelling of a status it has never seen', async () => {
    const { $ } = await viewPage(`${path}?redrive_conflict=QUARANTINED`)

    expect(flatten($('[data-testid="event-banner"]').text())).toContain(
      'QUARANTINED'
    )
  })

  test('escapes a conflicting status carrying markup', async () => {
    const { $ } = await viewPage(
      `${path}?redrive_conflict=${encodeURIComponent(xss)}`
    )

    const banner = $('[data-testid="event-banner"]')

    expect(banner.find('script')).toHaveLength(0)
    expect(banner.text()).toContain(xss)
  })

  test('says a redrive found no event', async () => {
    const { $ } = await viewPage(`${path}?redrive_error=missing`)

    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-error')
    expect(flatten(banner.text())).toContain('no longer has this event')
  })

  test('says a redrive could not reach the backend', async () => {
    const { $ } = await viewPage(`${path}?redrive_error=failed`)

    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-error')
    expect(flatten(banner.text())).toContain('could not be reached')
  })

  test('shows no banner on a page nothing redirected to', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-banner"]')).toHaveLength(0)
  })

  // ── The two answers that are not an event ─────────────────────────────────

  test('renders a small page for an event that does not exist', async () => {
    givenOutcome('not-found')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-not-found"]').text()).toBe('Event not found')
    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
    expect($('[data-testid="event-payload-card"]')).toHaveLength(0)
    expect($('[data-testid="event-journey-card"]')).toHaveLength(0)
  })

  test('keeps the list query on the way back from a page that is not there', async () => {
    givenOutcome('not-found')

    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=FAILED')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events?status=FAILED'
    )
  })

  test('drops a hostile from on the page that is not there either', async () => {
    givenOutcome('not-found')

    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('https://example.com')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
  })

  // A backend that is down is an alert on the page shell, not a red screen:
  // the operator opened this page because something is already wrong.
  test('shows an error alert when the event could not be read', async () => {
    givenOutcome('unavailable')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-error"]')).toHaveLength(1)
    expect($('[data-testid="event-back"]')).toHaveLength(1)
    expect($('[data-testid="event-facts-card"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-card"]')).toHaveLength(0)
    expect($('.govuk-heading-xl')).toHaveLength(0)
  })

  // ── Escaping, everywhere the endpoint passed a string through ─────────────

  test.each([
    ['a type', { type: xss }],
    ['a target', { targetRaw: xss }],
    ['a message id', { messageId: xss }],
    ['a traceparent', { traceparent: xss }],
    ['a reference', { segregationRef: xss }],
    ['a status', { status: xss }],
    ['a failure reason', { lastError: { name: xss, message: xss, at: null } }]
  ])('renders %s carrying markup as text', async (_name, overrides) => {
    givenEvent(detail(overrides as Partial<EventDetail>))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect($('main').text()).toContain(xss)
  })

  test('never renders a script the endpoint sent, anywhere on the page', async () => {
    givenEvent(
      detail({
        type: xss,
        segregationRef: xss,
        messageId: xss,
        targetRaw: xss,
        payload: { [xss]: xss }
      }),
      [row({ status: xss })]
    )

    const { $ } = await viewPage()

    expect($('script')).toHaveLength(1)
    expect($('main [onclick]')).toHaveLength(0)
    expect($('main script')).toHaveLength(0)
  })

  // The page said `attempts 5/5` and then, on one line, why the *last* of them
  // failed. The four before it are usually where the answer is: a timeout,
  // then a timeout, then a duplicate key is a different incident from four
  // duplicate keys, and neither is visible in a count.
  test('lists every attempt between the facts and the payload', async () => {
    const { $ } = await viewPage()

    const order = $('main section[data-testid], main div[data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        [
          'event-facts-card',
          'event-attempts-card',
          'event-payload-card',
          'event-journey-card'
        ].includes(id ?? '')
      )

    expect(order).toEqual([
      'event-facts-card',
      'event-attempts-card',
      'event-payload-card',
      'event-journey-card'
    ])
    expect($('[data-testid="event-attempts-heading"]').text()).toBe('Attempts')
  })

  // The instant, the gap in front of it, then what ended the attempt. A
  // relative time is the one spelling this line cannot use — five attempts
  // inside one minute are five identical phrases, and that is exactly the case
  // the timeline is read in — so it goes, and the delta beside the instant is
  // the arithmetic that makes a missing backoff visible without doing any.
  test('says each attempt as a number, an instant, a gap and the error', async () => {
    const { $ } = await viewPage()

    const attempts = $('[data-testid="event-attempt"]')
      .toArray()
      .map((attempt) => flatten($(attempt).text()))

    expect(attempts).toEqual([
      '#1 · 2026-06-16T10:08:00.000Z · after 8m 0s · MongoNetworkTimeoutError: connection timed out after 30000ms',
      '#2 · 2026-06-16T10:16:05.000Z · +8m 5s · MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
    ])
    expect($('[data-testid="event-attempt-list"]').text()).not.toContain('ago')
  })

  // The gap is what the timeline is for: four attempts inside a second is a
  // service retrying into a wall, and a column of timestamps does not say so.
  test('shows a missing backoff as a run of sub-second gaps', async () => {
    givenEvent(
      detail({
        createdAt: '2026-06-16T10:08:00.000Z',
        attemptHistory: [
          { at: '2026-06-16T10:08:00.120Z', name: 'E', message: 'boom' },
          { at: '2026-06-16T10:08:00.393Z', name: 'E', message: 'boom' },
          { at: '2026-06-16T10:08:00.905Z', name: 'E', message: 'boom' }
        ]
      })
    )

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-attempt-delta"]')
        .toArray()
        .map((delta) => $(delta).text())
    ).toEqual(['after 120ms', '+273ms', '+512ms'])
  })

  // The message is the one string on the page worth reading in full, so it
  // wraps rather than truncating — the list already cuts it to 64 characters.
  test('sets the attempt message in wrapping mono, tinted with the error colour', async () => {
    const { $ } = await viewPage()

    const error = $('[data-testid="event-attempt-error"]').first()

    expect(error.attr('class')).toContain('font-mono')
    expect(error.attr('class')).toContain('text-[11.5px]')
    expect(error.attr('class')).toContain('wrap-anywhere')
    expect(error.attr('class')).toContain('text-error/80')
    expect($('[data-testid="event-attempt-name"]').first().text()).toBe(
      'MongoNetworkTimeoutError'
    )
  })

  // A list of failures that simply stops reads as an event still failing.
  test('ends the timeline with the state the event is actually in', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-outcome')).toBe('dead-lettered')
  })

  test('ends a completed event at the instant it completed', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-outcome')).toBe(
      'completed at 2026-06-16T10:17:00Z'
    )
  })

  // An empty section reads as "it never failed", which is the opposite of what
  // an empty history means on a dead letter.
  test('says in words that an old event has no attempt history', async () => {
    givenEvent(detail({ attemptHistory: [] }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-list"]')).toHaveLength(0)
    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
  })

  test('escapes an attempt message containing markup', async () => {
    givenEvent(
      detail({
        attemptHistory: [
          { at: '2026-06-16T10:08:00.000Z', name: xss, message: xss }
        ]
      })
    )

    const { $ } = await viewPage()

    const attempt = $('[data-testid="event-attempt-error"]')

    expect(attempt.find('script')).toHaveLength(0)
    expect(attempt.text()).toContain(xss)
  })

  // The by-event-id `logs` link is gone: the traceparent fact offers the trace
  // and nothing else.
  test('renders no logs link beside the traceparent', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-fact-traceparent"]').text()).not.toContain(
      'logs'
    )
  })

  // An event with no traceparent now shows the em dash and nothing beside it,
  // where it used to keep a logs link the trace one could not offer.
  test('renders no link at all on an event carrying no trace', async () => {
    givenLogsExplorer()
    givenEvent(detail({ traceId: null, traceparent: null }))

    const { $ } = await viewPage()

    expect($('a[data-testid="event-traceparent"]')).toHaveLength(0)
    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-traceparent-none"]').text()).toBe('—')
  })

  // The way out into the logs survives as the traceparent value itself.
  test('keeps the way into the logs on the traceparent value itself', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    const trace = $('a[data-testid="event-traceparent"]')

    expect(trace).toHaveLength(1)
    expect(trace.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
    expect(trace.attr('target')).toBe('_blank')
    expect(trace.attr('rel')).toBe('noopener noreferrer')
    expect(
      trace.closest('[data-testid="event-fact-traceparent"]')
    ).toHaveLength(1)
  })

  test('offers Park beside Redrive on a dead letter', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
    expect($('[data-testid="event-park"]').attr('href')).toBe(
      `${path}?confirm=park`
    )
    expect($('[data-testid="event-unpark"]')).toHaveLength(0)
  })

  test('offers only Unpark on a parked event', async () => {
    givenEvent(detail({ status: 'PARKED', parked: parkedNote }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
    expect($('[data-testid="event-park"]')).toHaveLength(0)
    expect($('[data-testid="event-unpark"]').attr('href')).toBe(
      `${path}?confirm=unpark`
    )
  })

  test.each([['COMPLETED'], ['PUBLISHED']])(
    'offers neither park nor redrive on a %s event',
    async (status) => {
      givenEvent(detail({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-actions"]')).toHaveLength(0)
    }
  )

  // The reason is the whole point of the action, so the form asks for it and
  // will not submit without one.
  test('asks for a reason before it will park anything', async () => {
    const { $ } = await viewPage(`${path}?confirm=park`)
    const reason = $('[data-testid="event-park-reason"]')

    expect(valueOf($, 'event-park-question')).toContain('audited')
    expect(reason.attr('required')).toBeDefined()
    expect(reason.attr('maxlength')).toBe('512')
    expect(reason.attr('name')).toBe('reason')
    expect($('[data-testid="event-park-form"]').attr('action')).toBe(
      `${path}/park`
    )
    expect($('[data-testid="event-park-form"]').attr('method')).toBe('post')
  })

  test('carries the list the operator came from through the park', async () => {
    const { $ } = await viewPage(
      `${path}?from=%3Fstatus%3DDEAD_LETTER&confirm=park`
    )

    expect($('[data-testid="event-park-from"]').attr('value')).toBe(
      '?status=DEAD_LETTER'
    )
    expect($('[data-testid="event-park-cancel"]').attr('href')).toBe(
      `${path}?from=%3Fstatus%3DDEAD_LETTER`
    )
  })

  test('confirms an unpark on a parked event', async () => {
    givenEvent(detail({ status: 'PARKED', parked: parkedNote }))

    const { $ } = await viewPage(`${path}?confirm=unpark`)

    expect($('[data-testid="event-unpark-form"]').attr('action')).toBe(
      `${path}/unpark`
    )
    expect(valueOf($, 'event-unpark-question')).toContain('being a dead letter')
  })

  // Only one question is ever being asked: a second live button on a page that
  // writes to a queue is a page with two ways to press the wrong one.
  test('opens one confirmation panel at a time', async () => {
    const { $ } = await viewPage(`${path}?confirm=park`)

    expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-actions"]')).toHaveLength(0)
    expect($('[data-testid="event-park-confirm"]')).toHaveLength(1)
  })

  test('says why an event was parked, by whom and when', async () => {
    givenEvent(detail({ status: 'PARKED', parked: parkedNote }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-parked')).toBe(
      'duplicate key on a case that no longer exists · by Ada Lovelace · 2026-06-16T10:10:00Z'
    )
    expect(
      flatten(
        $('[data-testid="event-header"] [data-testid="do-status-label"]').text()
      )
    ).toBe('Parked')
  })

  test('says nothing about a park on an event nobody parked', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-parked"]')).toHaveLength(0)
  })

  test('renders a hostile park reason as text', async () => {
    givenEvent(
      detail({ status: 'PARKED', parked: { ...parkedNote, reason: xss } })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-parked"] script')).toHaveLength(0)
    expect(valueOf($, 'event-parked')).toContain(xss)
  })

  test.each([
    ['parked=1', 'set aside'],
    ['unparked=1', 'dead letter again'],
    ['park_conflict=COMPLETED', 'Its status is now Completed.'],
    ['park_error=missing', 'no longer has this event'],
    ['park_error=failed', 'could not be reached']
  ])('says what the %s redirect was carrying', async (query, message) => {
    const { $ } = await viewPage(`${path}?${query}`)

    expect(valueOf($, 'event-banner')).toContain(message)
  })

  test('warns above the buttons when a redrive already failed the same way', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts, lastRedrive }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-futile-warning')).toBe(
      'A previous redrive (by Ada Lovelace, 2026-06-16T10:10:00Z) failed with the identical error — redriving again is unlikely to succeed until the underlying cause is fixed. Consider Park.'
    )
    // A note, not a block: the button is exactly where it was.
    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
  })

  test('warns about no futile redrive when the last two attempts failed differently', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-futile-warning"]')).toHaveLength(0)
  })

  test('warns about no futile redrive when nobody has redriven it', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-futile-warning"]')).toHaveLength(0)
  })

  test('names when an event was last redriven and who by', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-last-redrive')).toBe(
      '2026-06-16T10:10:00Z · by Ada Lovelace'
    )
  })

  test('says nothing about a redrive on an event nobody has redriven', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-last-redrive"]')).toHaveLength(0)
  })

  test('offers every other dead letter with this error', async () => {
    const { $ } = await viewPage()
    const link = $('[data-testid="event-error-search"]')

    expect(link.text()).toContain('Show all events with this error')
    expect(link.attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+id_1'
    )
  })

  // The whole message travels, including the characters a url is made of and
  // the ones that would otherwise be markup.
  test('escapes a hostile message into the shared failure href rather than out of it', async () => {
    givenEvent(detail({ lastError: { name: 'Error', message: xss, at: null } }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-search"]').attr('href')).toBe(
      `/dev-ops/events?${new URLSearchParams({ status: 'DEAD_LETTER', error: xss })}`
    )
    expect($('[data-testid="event-fact-last-error"] script')).toHaveLength(0)
  })

  test('offers no shared failure link on an event with no failure recorded', async () => {
    givenEvent(detail({ lastError: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-search"]')).toHaveLength(0)
  })

  test('says how long each journey hop took', async () => {
    givenEvent(detail(), [
      row({
        createdAt: '2026-06-16T10:00:00.000Z',
        completedAt: '2026-06-16T10:00:01.200Z'
      }),
      row({ id: '665f1c2e9a1b2c3d4e5f6a7c', completedAt: null })
    ])

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-journey-took"]')
        .toArray()
        .map((cell) => $(cell).text())
    ).toEqual(['1.2s', '—'])
  })

  test('heads the journey table with the hop latency column', async () => {
    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-journey"] th')
        .toArray()
        .map((cell) => $(cell).text())
    ).toEqual(['Queue', 'Status', 'Took', 'Created'])
  })
})
