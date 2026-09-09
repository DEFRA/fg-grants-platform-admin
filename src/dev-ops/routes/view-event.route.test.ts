import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  EventDetail,
  JourneyHop
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
/**
 * The facts card is the one part of this page that branches on the kind, so
 * the facts that belong to only one are asserted at the address that has them.
 */
const inboxPath = `/dev-ops/events/gas/inbox/${id}`

/**
 * One event as fg-gas-backend composes it, at its OUTBOX address. The three
 * inbox-only facts are absent rather than null — something this service
 * published carries no reference and no trace of its own — so the outbox
 * fixture simply has no key for them.
 */
const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  typeTitle: 'cloud.defra.prd.fg-gas-backend.case.update.status',
  hop: 'GAS Outbox',
  queue: 'to Caseworking',
  queueValue: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  showAttempts: true,
  createdAt: '2026-06-16T10:00:00.000Z',
  lastFailureAt: '2026-06-16T10:16:05.000Z',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events index: id_1',
    at: '2026-06-16T10:16:05.000Z'
  },
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
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
  occurredAt: null,
  messageGroupId: 'GLD-9B2',
  publicationDate: '2026-06-16T10:00:01.000Z',
  completionDate: null,
  lastResubmissionDate: null,
  claimedAt: '2026-06-16T10:16:00.000Z',
  claimExpiresAt: '2026-06-16T10:21:00.000Z',
  lastRedrive: null,
  ...overrides
})

/**
 * The same message at its INBOX address: it names a producer instead of a
 * target, carries no message group, and is the only half of the pattern with
 * a reference and a trace of its own.
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
    traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
    traceId,
    ...overrides
  })

const journeyHop = (overrides: Partial<JourneyHop> = {}): JourneyHop => ({
  service: 'gas',
  box: 'outbox',
  id,
  hop: 'GAS Outbox',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  startedAt: '2026-06-16T10:00:00.000Z',
  took: '1.2s',
  ...overrides
})

const givenEvent = (
  event: EventDetail = detail(),
  journey: JourneyHop[] = [journeyHop()]
) =>
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'found',
    event,
    journey
  })

const givenOutcome = (outcome: 'not-found' | 'unavailable') =>
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome,
    event: null,
    journey: []
  })

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

/** Two attempts that failed the same way — the shape of a futile retry. */
const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    stack: null
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    stack: null
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

  // A path is not a filter: a service outside the two is a url nobody ever
  // issued.
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

  // Every instant this page draws is UTC, so it says so nowhere. Swept whole,
  // attributes included, because a title is visible too.
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

  // No title where the full type says nothing the short one does not.
  test('hangs no title on a type the endpoint sent no fuller spelling for', async () => {
    givenEvent(detail({ typeTitle: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-type"]').attr('title')).toBeUndefined()
  })

  test('heads an audit record with its id, and names it audit', async () => {
    givenEvent(
      detail({ type: 'audit', typeTitle: 'Audit record — not a CloudEvent' })
    )

    const { $ } = await viewPage()

    const title = $('[data-testid="event-title"]')

    const type = $('[data-testid="event-type"]')

    expect(title.is('h1')).toBe(true)
    expect(title.text().trim()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(type.text()).toBe('audit')
    expect(type.attr('title')).toBe('Audit record — not a CloudEvent')
    expect($('[data-testid="event-header"]').text()).not.toContain('n/a')
  })

  // The detail page knows nothing about what a label means either: `unknown`
  // is a record that stores no type and is not an audit record, and it draws
  // with its explanation on the title exactly as `audit` does.
  test('draws the unknown label like any other type, with its title', async () => {
    givenEvent(
      detail({
        type: 'unknown',
        typeTitle: 'No event type recorded — not a CloudEvent'
      })
    )

    const { $ } = await viewPage()

    const type = $('[data-testid="event-type"]')

    expect(type.text()).toBe('unknown')
    expect(type.attr('title')).toBe('No event type recorded — not a CloudEvent')
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

  // A healthy first-attempt row has neither a failure to date nor a count
  // worth reporting, and says nothing rather than `1/5`.
  test('says nothing about attempts on a first-attempt event', async () => {
    givenEvent(
      detail({
        status: 'PUBLISHED',
        statusLabel: 'Published',
        statusRole: 'neutral',
        attempts: '1/5',
        showAttempts: false,
        lastFailureAt: null,
        lastError: null
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
  })

  // Drawn on the strength of the endpoint's own judgement, even on a row that
  // has not failed: a retried event has a count worth reading.
  test('shows the attempts figure when the endpoint says it is worth reporting', async () => {
    givenEvent(
      detail({
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        statusRole: 'warning',
        statusRetrying: true,
        attempts: '3/5',
        showAttempts: true,
        lastFailureAt: null
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-failure"]')).toHaveLength(1)
    expect(valueOf($, 'event-attempts')).toBe('3/5')
    expect(valueOf($, 'event-last-failure')).toBe('—')
  })

  // This is the page an operator came to in order to take the id away, so it
  // is whole and it is selectable text - no button stands between them.
  test('shows the whole event id once, as plain selectable text', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-title"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
    expect($('[data-testid="event-header"] button')).toHaveLength(0)
  })

  test('does not print the same id twice in the header', async () => {
    const { $ } = await viewPage()

    const header = $('[data-testid="event-header"]').text()
    const id = '3f2c1a0e-1111-2222-3333-444455556666'

    expect(header.split(id)).toHaveLength(2)
  })

  // ── The facts ─────────────────────────────────────────────────────────────

  // The Queue fact IS the list's Queue cell — two lines, off one builder — so
  // an operator who clicks a row finds the fact they were just reading.
  test('reads the queue exactly as the list cell does, on a domain outbox row', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-hop')).toBe('GAS Outbox')
    expect(valueOf($, 'event-queue')).toBe('to Caseworking')
    expect(valueOf($, 'event-fact-route')).not.toContain('→')
    expect($('[data-testid="event-route"]')).toHaveLength(0)
    expect($('[data-testid="event-route-detail"]')).toHaveLength(0)
  })

  // The hop links at the whole service: this page has no list query to keep.
  // Plain text, exactly as the list draws it. The journey table below still
  // links each hop to its own page - that is row navigation, not a filter.
  test('draws the hop as plain text, linking nowhere', async () => {
    const { $ } = await viewPage()

    const hop = $('[data-testid="event-hop"]')

    expect(hop.is('a')).toBe(false)
    expect(hop.attr('href')).toBeUndefined()
    expect(hop.text().trim()).toBe('GAS Outbox')
    expect(hop.find('a')).toHaveLength(0)
  })

  // The ARN is still the string an operator opened this page to take away, so
  // it stays one click from the line it belongs to.
  test('keeps the raw target on a copy button beside the queue line', async () => {
    const { $ } = await viewPage()

    const raw =
      'arn:aws:sns:eu-west-2:000000000000:gas__sns__update_case_status_fifo'

    expect(valueOf($, 'event-fact-route')).not.toContain(raw)
    expect($('[data-testid="event-target-raw"]')).toHaveLength(0)
    expect($('[data-testid="event-queue"]').attr('title')).toBe(
      'gas__sns__update_case_status_fifo'
    )
  })

  test('names the producer on an inbox row', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect(valueOf($, 'event-hop')).toBe('GAS Inbox')
    expect(valueOf($, 'event-queue')).toBe('from Caseworking')
    expect($('[data-testid="event-queue"]').attr('title')).toBeUndefined()
  })

  test('links the reference at every event about the same thing', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const ref = $('[data-testid="event-segregation-ref"]')

    expect(ref.is('a')).toBe(true)
    expect(ref.attr('href')).toBe('/dev-ops/events?q=GLD-9B2-BWS-grasslands')
    expect(ref.text()).toBe('GLD-9B2-BWS-grasslands')
  })

  // On an inbox document the message id IS the event id — one string under
  // two names, so only the heading says it.
  test('draws no Message id row, the heading being that same id', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-fact-message-id"]')).toHaveLength(0)
    expect($('[data-testid="event-message-id"]')).toHaveLength(0)
    expect($('[data-testid="event-title"]').text().trim()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
  })

  test('shows the traceparent in mono, as the explorer link itself', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const traceparent = $('a[data-testid="event-traceparent"]')

    expect(traceparent.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
    expect(traceparent.attr('class')).toContain('font-mono')
    expect(traceparent.attr('href')).toContain(logsBase)
    expect(traceparent.attr('href')).toContain(traceId)
    expect(traceparent.attr('target')).toBe('_blank')
    expect(traceparent.attr('rel')).toBe('noopener noreferrer')
    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
  })

  test('draws no explorer link when the event carries no trace', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail({ traceId: null, traceparent: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('a[data-testid="event-traceparent"]')).toHaveLength(0)
    expect($('[data-testid="event-traceparent-none"]').text()).toBe('—')
  })

  test('leaves the traceparent plain text when no explorer is configured', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const traceparent = $('[data-testid="event-traceparent"]')

    expect(traceparent).toHaveLength(1)
    expect(traceparent.is('a')).toBe(false)
    expect(traceparent.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
  })

  // Absolute only: a relative time goes stale in an open tab, and a London
  // spelling cannot be quoted against a log line.
  test('says when the event was created, absolutely and only absolutely', async () => {
    const { $ } = await viewPage()

    // Created is drawn by the same macro every other instant on this page
    // uses, so it carries that macro's value id rather than one of its own.
    expect(valueOf($, 'event-fact-created-value')).toBe('2026-06-16T10:00:00Z')
    expect($('[data-testid="event-created-relative"]')).toHaveLength(0)
    expect($('[data-testid="event-created-london"]')).toHaveLength(0)
  })

  // ── The facts card, per kind ─────────────────────────────────────────────

  /** Every label the facts card draws, in the order it draws them. */
  const labelsOf = ($: CheerioAPI) =>
    $('[data-testid="event-facts"] dt')
      .toArray()
      .map((label) => flatten($(label).text()))

  test('draws the inbox lifecycle, in the order the message travelled', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect(labelsOf($)).toEqual([
      'Queue',
      'Reference',
      'Traceparent',
      'Created',
      'Occurred',
      'Received',
      'Claimed',
      'Claim expires',
      'Completed',
      'Last resubmission',
      'Attempts',
      'Last error'
    ])
    expect(valueOf($, 'event-fact-occurred-value')).toBe('2026-06-16T09:59:58Z')
    expect(valueOf($, 'event-fact-publication-value')).toBe(
      '2026-06-16T10:00:01Z'
    )
  })

  // An outbox row has no reference, message id or traceparent of its own —
  // the wrapped event's trace is in the payload below, and lifting it into a
  // fact would claim it as this record's.
  test('draws the outbox lifecycle, and omits what an outbox row has not got', async () => {
    const { $ } = await viewPage()

    expect(labelsOf($)).toEqual([
      'Queue',
      'Message group',
      'Created',
      'Queued',
      'Claimed',
      'Claim expires',
      'Published',
      'Last resubmission',
      'Attempts',
      'Last error'
    ])
    expect(valueOf($, 'event-message-group')).toBe('GLD-9B2')
    // Omitted, not dashed: these do not apply to an outbox row at all.
    for (const absent of [
      'event-fact-reference',
      'event-fact-message-id',
      'event-fact-traceparent',
      'event-fact-occurred'
    ]) {
      expect($(`[data-testid="${absent}"]`)).toHaveLength(0)
    }
    // The wrapped event's traceparent is still readable, in the payload.
    expect($('[data-testid="event-payload"]')).toHaveLength(1)
  })

  // A dash means "this exists and is empty"; an absent row means "this does
  // not apply here". The two must never be spelled the same way.
  test('dashes an outbox instant that exists and is null', async () => {
    givenEvent(
      detail({
        claimedAt: null,
        claimExpiresAt: null,
        lastResubmissionDate: null
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-fact-claimed-at-value')).toBe('—')
    expect(valueOf($, 'event-fact-claim-expires-value')).toBe('—')
    expect(valueOf($, 'event-fact-last-resubmission-value')).toBe('—')
  })

  test('omits the message group on an outbox row that has none', async () => {
    givenEvent(detail({ messageGroupId: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-message-group"]')).toHaveLength(0)
    expect(labelsOf($)).not.toContain('Message group')
  })

  // A document the endpoint could read no time out of is a malformed message,
  // not a fact the page is missing.
  test('omits Occurred on an inbox row the endpoint reports no time for', async () => {
    givenEvent(inboxDetail({ occurredAt: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-fact-occurred"]')).toHaveLength(0)
    expect(labelsOf($)).not.toContain('Occurred')
  })

  // The row's own order key IS one of the lifecycle instants on a GAS
  // document, so printing it twice would be one instant claiming to be two
  // facts. The lifecycle label wins.
  test('draws Created once, never twice under two labels', async () => {
    givenEvent(
      detail({
        createdAt: '2026-06-16T10:00:01.000Z',
        publicationDate: '2026-06-16T10:00:01.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(labelsOf($)).not.toContain('Created')
    expect(labelsOf($)).toContain('Queued')
    expect(valueOf($, 'event-fact-publication-value')).toBe(
      '2026-06-16T10:00:01Z'
    )
  })

  // ── Timing baselines and stale instants ──────────────────────────────────

  // A redrive leaves the old `completionDate` on the document, and drawing it
  // on a dead letter said the row had been published.
  test('dashes a completion instant left behind by a redrive', async () => {
    givenEvent(
      detail({
        status: 'DEAD_LETTER',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-fact-completion-value')).toBe('—')
    // The timeline still narrates what happened, which is the point of it.
    expect($('[data-testid="event-attempts-card"]')).toHaveLength(1)
  })

  test('states the completion instant on a row that did complete', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-fact-completion-value')).toBe(
      '2026-06-16T10:17:00Z'
    )
  })

  // An inbox row's `createdAt` is the producer's clock, so measuring the
  // first attempt from it booked the transit leg to this box.
  test('measures the first attempt from receipt, not from the producer clock', async () => {
    givenEvent(
      detail({
        createdAt: '2026-06-16T09:00:00.000Z',
        publicationDate: '2026-06-16T10:00:00.000Z',
        attemptHistory: [
          {
            at: '2026-06-16T10:00:30.000Z',
            name: 'MongoServerError',
            message: 'boom',
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage(inboxPath)

    // 30 seconds after receipt, not the hour since the producer stamped it.
    expect(valueOf($, 'event-attempt-delta')).toBe('after 30.0s')
  })

  // The outbox has no such gap: there `createdAt` IS the moment it was queued.
  test('measures an outbox attempt from the moment it was queued', async () => {
    givenEvent(
      detail({
        createdAt: '2026-06-16T10:00:00.000Z',
        publicationDate: '2026-06-16T10:00:00.000Z',
        attemptHistory: [
          {
            at: '2026-06-16T10:00:45.000Z',
            name: 'MongoServerError',
            message: 'boom',
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-delta')).toBe('after 45.0s')
  })

  // The log window opens around the moment this service saw the message.
  test('anchors the trace window at receipt on an inbox row', async () => {
    givenLogsExplorer()
    givenEvent(
      inboxDetail({
        createdAt: '2026-06-16T09:00:00.000Z',
        publicationDate: '2026-06-16T10:00:00.000Z'
      })
    )

    const { $ } = await viewPage(inboxPath)

    const href = $('a[data-testid="event-traceparent"]').attr('href') ?? ''

    // The window is centred on the anchor: receipt at 10:00 opens it at 04:00,
    // where the producer's 09:00 would have opened it at 03:00.
    expect(href).toContain("from:'2026-06-16T04:00:00.000Z'")
    expect(href).not.toContain("from:'2026-06-16T03:00:00.000Z'")
  })

  // ── The attempts fragment under the title ────────────────────────────────

  // `attempts 1/5` is the figure every healthy event carries, so the endpoint
  // says not to draw it — and the card below still lists what was recorded.
  test('says nothing about attempts on a completed first-try event', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success',
        attempts: '1/5',
        showAttempts: false,
        lastFailureAt: null,
        lastError: null,
        completionDate: '2026-06-16T10:00:02.000Z'
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
    expect($('[data-testid="event-attempts-card"]')).toHaveLength(1)
  })

  test('states every timestamp absolutely, never how long ago', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z',
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

  // Every instant this page states is plain selectable text: the whole card
  // is, so an operator takes any of it the way they take text anywhere.
  test('states every timestamp as text, behind no button', async () => {
    givenEvent(
      detail({
        // Completed, so the completion instant is a fact about this row's
        // state rather than a leftover from before a redrive.
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z',
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    const stated = (testId: string) =>
      flatten($(`[data-testid="${testId}"]`).text())

    expect(stated('event-fact-created-value')).toBe('2026-06-16T10:00:00Z')
    expect(stated('event-fact-publication-value')).toBe('2026-06-16T10:00:01Z')
    expect(stated('event-fact-completion-value')).toBe('2026-06-16T10:17:00Z')
    expect(stated('event-fact-last-resubmission-value')).toBe(
      '2026-06-16T10:16:30Z'
    )
    expect(stated('event-fact-claimed-at-value')).toBe('2026-06-16T10:16:00Z')
    expect(stated('event-fact-claim-expires-value')).toBe(
      '2026-06-16T10:21:00Z'
    )
    expect(stated('event-last-redrive-at')).toBe('2026-06-16T10:15:00Z')
    expect(stated('event-error-at')).toBe('at 2026-06-16T10:16:05Z')
    expect($('[data-testid="event-facts"] button')).toHaveLength(0)
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

  test('states the attempts figure in the facts card', async () => {
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

  // Null, not absent: an inbox row that stored no reference has the field and
  // has nothing in it, which is the dash rather than a row left out.
  test('draws a dash for a reference the event has not got', async () => {
    givenEvent(inboxDetail({ segregationRef: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-segregation-ref-none"]').text()).toBe('—')
    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  // ── The payload ───────────────────────────────────────────────────────────

  // One `pre` per line, numbered, in a scroller bounded so a large document
  // cannot push the sections under it off the bottom of the page.
  test('prints the payload as pretty json, a line at a time', async () => {
    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')
    const json = JSON.stringify(
      { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
      null,
      2
    )

    expect(payload.attr('class')).not.toContain('mockup-code')
    expect(payload.attr('class')).toContain('border border-base-300')
    expect(payload.attr('class')).toContain('max-h-96')
    expect(payload.attr('class')).toContain('overflow-auto')
    expect(payload.find('pre > code')).toHaveLength(json.split('\n').length)
    expect(
      payload
        .find('code')
        .toArray()
        .map((line) => $(line).text())
        .join('\n')
    ).toBe(json)

    // Numbered — and the numbers are drawn by the stylesheet from an
    // attribute rather than written into the markup, so a selection dragged
    // across the block copies the payload and not a numbered listing of it.
    const gutter = payload.find('[data-testid="event-payload-line"] > span')
    const numbers = gutter.toArray().map((line) => $(line).attr('data-line'))

    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3'])
    expect(numbers).toHaveLength(json.split('\n').length)
    expect(gutter.first().text()).toBe('')
    expect(gutter.first().attr('class')).toContain(
      'before:content-[attr(data-line)]'
    )
    expect(gutter.first().attr('aria-hidden')).toBe('true')
  })

  // A reference table is read across as well as down — but only where there
  // is width: labels stack above values on a narrow screen, because a value
  // here is an ARN or a traceparent.
  test('sets the facts as two definition columns on a wide screen', async () => {
    const { $ } = await viewPage()

    const facts = $('[data-testid="event-facts"]')

    expect(facts.is('dl')).toBe(true)
    expect(facts.attr('class')).toContain('grid-cols-1')
    expect(facts.attr('class')).toContain('sm:grid-cols-[9.5rem_minmax(0,1fr)]')
    expect(facts.attr('class')).toContain(
      'lg:grid-cols-[9.5rem_minmax(0,1fr)_9.5rem_minmax(0,1fr)]'
    )
    // Every pair is still one testid over a label and a value, so the grid is
    // a layout and not a re-modelling of the facts.
    const pair = $('[data-testid="event-fact-route"]')

    expect(pair.attr('class')).toBe('contents')
    expect(pair.children('dt')).toHaveLength(1)
    expect(pair.children('dd')).toHaveLength(1)
  })

  // One word for this across all three surfaces. The test id keeps the older
  // name: it is an internal handle, not a label.
  test('heads the hop fact with the word all three surfaces use', async () => {
    const { $ } = await viewPage()

    const pair = $('[data-testid="event-fact-route"]')

    expect(pair.children('dt').text()).toBe('Queue')
    expect(pair.text()).not.toContain('Route')
    // Scoped to the page's own labels — its `dt`s and `th`s. A payload
    // legitimately carries a CloudEvent `source` field, and that is the
    // message's vocabulary rather than this page's.
    expect(
      $('main dt, main th')
        .toArray()
        .map((label) => $(label).text().trim())
    ).not.toContain('Source')
    expect($('[data-testid="event-journey"] th').first().text().trim()).toBe(
      'Queue'
    )
    expect(flatten(pair.find('[data-testid="event-hop"]').text())).toBe(
      'GAS Outbox'
    )
    expect(flatten(pair.find('[data-testid="event-queue"]').text())).toBe(
      'to Caseworking'
    )
  })

  // The line numbers are drawn with CSS rather than as text, so selecting
  // across the block still yields the payload and not a numbered listing of
  // it - which is what the copy button used to be for.
  test('offers the payload as selectable text, behind no button', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-payload-card"] button')).toHaveLength(0)
    expect(flatten($('[data-testid="event-payload"]').text())).toContain(
      '"caseRef": "GLD-9B2"'
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
      journeyHop(),
      journeyHop({
        id: '111111111111111111111111',
        box: 'inbox',
        service: 'caseworking',
        hop: 'CW Inbox',
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success'
      })
    ])

    const { $ } = await viewPage()

    const rows = $('[data-testid="event-journey-row"]')

    expect(rows).toHaveLength(2)
    expect(
      $('[data-testid="event-journey-link"]')
        .toArray()
        .map((link) => $(link).text().trim())
    ).toEqual(['GAS Outbox', 'CW Inbox'])
  })

  test('links every hop at its own page', async () => {
    givenEvent(detail(), [
      journeyHop(),
      journeyHop({ id: '111111111111111111111111', box: 'inbox' })
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
      journeyHop(),
      journeyHop({ id: '111111111111111111111111', box: 'inbox' })
    ])

    const { $ } = await viewPage()

    const rows = $('[data-testid="event-journey-row"]')

    expect(rows.first().hasClass('bg-base-200')).toBe(true)
    expect(rows.last().hasClass('bg-base-200')).toBe(false)
    expect($('[data-testid="event-journey-current"]')).toHaveLength(1)
    expect(valueOf($, 'event-journey-current')).toBe('this event')
  })

  // The instant is the moment that hop's own box took the message.
  test('states each hop status and the instant its box took the message', async () => {
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
    givenEvent(detail(), [journeyHop()])

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
    expect(back.text().trim()).toBe('Events')
    expect(back.closest('.breadcrumbs')).toHaveLength(1)

    // The leaf keeps its two ends and its title: spelled out it wrapped the
    // trail and repeated the heading two lines below.
    const leaf = $('[data-testid="event-breadcrumb-id"]')

    expect(leaf.text()).toBe('3f2c1a0e…6666')
    expect(leaf.attr('title')).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect($('[data-testid="event-title"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
  })

  // A short id is not worth cutting: the crumb only trims what would wrap.
  test('leaves a short id whole in the breadcrumb', async () => {
    givenEvent(detail({ eventId: '665f1c2e9a1b2c3d' }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-breadcrumb-id"]').text()).toBe(
      '665f1c2e9a1b2c3d'
    )
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
      'Redrive this event? The poller will retry it up to the attempt limit shown on the row. This action is audited.'
    )
    // The ceiling is the backend's policy, and the row already states it: a
    // number restated in this sentence goes quietly wrong the day it changes.
    expect(valueOf($, 'event-redrive-question')).not.toMatch(/\d/)
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

  // The label travels on the redirect, in the words fg-gas-backend spells it —
  // the same words every badge wears — and the banner prints what it was handed.
  test('names the status that refused a redrive', async () => {
    const { $ } = await viewPage(`${path}?redrive_conflict=Resubmitted`)

    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-warning')
    expect(flatten(banner.text())).toContain('Its status is now Resubmitted.')
  })

  // A conflict whose body named no label falls back to the raw status, which
  // is still the string worth grepping for.
  test('names the raw status when the backend sent no label for it', async () => {
    const { $ } = await viewPage(`${path}?redrive_conflict=QUARANTINED`)

    expect(flatten($('[data-testid="event-banner"]').text())).toContain(
      'Its status is now QUARANTINED.'
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

  // The event could not be read, so its id is not on the page - but the
  // address still names a row, and a breadcrumb whose leaf is blank says
  // nothing about which page failed.
  test('names the row from the address when the event could not be read', async () => {
    givenOutcome('unavailable')

    const { $ } = await viewPage()

    expect($('[data-testid="event-breadcrumbs"]').text()).toContain(
      id.slice(-4)
    )
  })

  // ── Escaping, everywhere the endpoint passed a string through ─────────────

  test.each([
    ['a type', { type: xss }],
    ['a hop', { hop: xss }],
    ['a queue line', { queue: xss }],
    ['a traceparent', { traceparent: xss }],
    ['a reference', { segregationRef: xss }],
    ['a status label', { statusLabel: xss }],
    ['an attempts figure', { attempts: xss }],
    ['a failure reason', { lastError: { name: xss, message: xss, at: null } }]
  ])('renders %s carrying markup as text', async (_name, overrides) => {
    givenEvent(inboxDetail(overrides as Partial<EventDetail>))

    const { $ } = await viewPage(inboxPath)

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect($('main').text()).toContain(xss)
  })

  // Two values the page states only as attributes: the raw ARN rides the copy
  // button's `value`, and the raw status rides the badge's `title` now that the
  // words beside it are their own field. Markup in either has to arrive escaped
  // as an attribute and never as an element.
  test('renders a raw status carrying markup as an attribute and nothing else', async () => {
    givenEvent(detail({ status: xss }))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect(
      $('[data-testid="event-header"] [data-testid="do-status-badge"]').attr(
        'title'
      )
    ).toBe(xss)
  })

  test('never renders a script the endpoint sent, anywhere on the page', async () => {
    givenEvent(
      inboxDetail({
        type: xss,
        typeTitle: xss,
        segregationRef: xss,
        payload: { [xss]: xss }
      }),
      [journeyHop({ status: xss, statusLabel: xss, hop: xss })]
    )

    const { $ } = await viewPage()

    expect($('script')).toHaveLength(1)
    expect($('main [onclick]')).toHaveLength(0)
    expect($('main script')).toHaveLength(0)
  })

  // The attempts before the last are usually where the answer is: a timeout,
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

    // The journey is four lines about where this message went; the payload is
    // a screenful of the message itself, and a two-row table pushed below a
    // hundred lines of JSON is a table nobody scrolls to.
    expect(order).toEqual([
      'event-facts-card',
      'event-attempts-card',
      'event-journey-card',
      'event-payload-card'
    ])
    expect($('[data-testid="event-attempts-heading"]').text()).toBe('Attempts')
  })

  // Absolute, with the gap in front: five attempts inside one minute are five
  // identical relative phrases, and the delta is the arithmetic that makes a
  // missing backoff visible.
  test('says each attempt as a number, an instant, a gap and the error', async () => {
    const { $ } = await viewPage()

    const attempts = $('[data-testid="event-attempt"]')
      .toArray()
      .map((attempt) => ({
        number: flatten(
          $(attempt).find('[data-testid="event-attempt-number"]').text()
        ),
        when: flatten(
          $(attempt).find('[data-testid="event-attempt-when"]').text()
        ),
        delta: flatten(
          $(attempt).find('[data-testid="event-attempt-delta"]').text()
        ),
        error: flatten(
          $(attempt).find('[data-testid="event-attempt-error"]').text()
        )
      }))

    expect(attempts).toEqual([
      {
        number: '#1',
        when: '2026-06-16T10:08:00.000Z',
        delta: 'after 8m 0s',
        error: 'MongoNetworkTimeoutError: connection timed out after 30000ms'
      },
      {
        number: '#2',
        when: '2026-06-16T10:16:05.000Z',
        delta: '+8m 5s',
        error:
          'MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
      }
    ])
    expect($('[data-testid="event-attempt-list"]').text()).not.toContain('ago')
  })

  // Four attempts inside a second is a service retrying into a wall, and a
  // column of timestamps does not say so.
  test('shows a missing backoff as a run of sub-second gaps', async () => {
    givenEvent(
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
          }
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
  // wraps rather than truncating.
  test('sets the attempt message in wrapping mono, tinted with the error colour', async () => {
    const { $ } = await viewPage()

    const error = $('[data-testid="event-attempt-error"]').first()

    expect(error.attr('class')).toContain('font-mono')
    expect(error.attr('class')).toContain('text-xs')
    expect(error.attr('class')).toContain('wrap-anywhere')
    expect(error.attr('class')).toContain('text-error/80')
    expect($('[data-testid="event-attempt-name"]').first().text()).toBe(
      'MongoNetworkTimeoutError'
    )
  })

  // ── The attempt stack, revealed by expanding a row ───────────────────────

  const withStack = (stack: string | null) =>
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:08:00.000Z',
            name: 'MongoServerError',
            message: 'boom',
            stack
          }
        ]
      })
    )

  const STACK =
    'MongoServerError: boom\n    at handler (/app/src/x.js:1:1)\n    at run (/app/src/y.js:2:2)'

  test('reveals the stack behind a collapsed expander, whole', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const details = $('[data-testid="event-attempt-details"]')
    const stack = $('[data-testid="event-attempt-stack"]')

    expect(details.is('details')).toBe(true)
    // Collapsed: the message is what the page is scanned for.
    expect(details.attr('open')).toBeUndefined()
    expect(stack.text()).toBe(STACK)
  })

  test('sets the stack in muted, wrapping monospace inside its own scroller', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const stack = $('[data-testid="event-attempt-stack"]')

    expect(stack.is('pre')).toBe(true)
    expect(stack.attr('class')).toContain('font-mono')
    expect(stack.attr('class')).toContain('whitespace-pre-wrap')
    expect(stack.attr('class')).toContain('text-base-content/50')
    // A single unbreakable frame must not widen the page.
    expect(stack.parent().attr('class')).toContain('overflow-x-auto')
  })

  // Nothing to reveal, so no chrome to reveal it with.
  test.each([[null], ['']])(
    'draws no expander on an attempt whose stack is %p',
    async (stack) => {
      withStack(stack)

      const { $ } = await viewPage()

      expect($('[data-testid="event-attempt-details"]')).toHaveLength(0)
      expect($('[data-testid="event-attempt-stack"]')).toHaveLength(0)
      // The error line is still drawn, exactly as it was before.
      expect($('[data-testid="event-attempt-error"]').text()).toContain('boom')
    }
  )

  // The disclosure is the browser's, so its keyboard operation and its
  // expanded state come free; what this owes is a name that says what opens.
  test('names the expander for a screen reader', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const summary = $('[data-testid="event-attempt-error"]')

    expect(summary.is('summary')).toBe(true)
    expect(summary.closest('details')).toHaveLength(1)
    expect(flatten(summary.text())).toContain('MongoServerError: boom')
    expect(flatten(summary.text())).toContain('stacktrace')
    expect(summary.find('.sr-only').text()).toBe('stacktrace')
  })

  test('renders a stack carrying markup as text', async () => {
    withStack(`${xss}\n    at handler (/app/src/x.js:1:1)`)

    const { $ } = await viewPage()

    const stack = $('[data-testid="event-attempt-stack"]')

    expect(stack.find('script')).toHaveLength(0)
    expect($('main script')).toHaveLength(0)
    expect(stack.text()).toContain(xss)
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
    // One line, not a section: this absence is the ordinary case for every
    // event written before attempt history existed.
    const empty = $('[data-testid="event-attempts-empty"]')

    expect(empty.attr('class')).not.toContain('text-center')
    expect(empty.attr('class')).not.toContain('py-6')
    expect(empty.prev().attr('data-testid')).toBe('event-attempts-heading')
  })

  test('escapes an attempt message containing markup', async () => {
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:08:00.000Z',
            name: xss,
            message: xss,
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    const attempt = $('[data-testid="event-attempt-error"]')

    expect(attempt.find('script')).toHaveLength(0)
    expect(attempt.text()).toContain(xss)
  })

  test('renders no logs link beside the traceparent', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-fact-traceparent"]').text()).not.toContain(
      'logs'
    )
  })

  test('renders no link at all on an event carrying no trace', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail({ traceId: null, traceparent: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('a[data-testid="event-traceparent"]')).toHaveLength(0)
    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-traceparent-none"]').text()).toBe('—')
  })

  test('keeps the way into the logs on the traceparent value itself', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const trace = $('a[data-testid="event-traceparent"]')

    expect(trace).toHaveLength(1)
    expect(trace.text()).toBe(`00-${traceId}-00f067aa0ba902b7-01`)
    expect(trace.attr('target')).toBe('_blank')
    expect(trace.attr('rel')).toBe('noopener noreferrer')
    expect(
      trace.closest('[data-testid="event-fact-traceparent"]')
    ).toHaveLength(1)
  })

  test('offers Redrive alone on a dead letter', async () => {
    const { $ } = await viewPage()

    const actions = $('[data-testid="event-actions"]')

    expect($('[data-testid="event-redrive"]').attr('href')).toBe(
      `${path}?confirm=redrive`
    )
    expect(actions.children()).toHaveLength(1)
    expect(actions.text()).not.toContain('Park')
    expect($('[data-testid="event-park"]')).toHaveLength(0)
    expect($('[data-testid="event-unpark"]')).toHaveLength(0)
  })

  test.each([['COMPLETED'], ['PUBLISHED']])(
    'offers no redrive on a %s event',
    async (status) => {
      givenEvent(detail({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-actions"]')).toHaveLength(0)
    }
  )

  // Only one confirmation is ever open: a second live button on a page that
  // writes to a queue is a page with two ways to press the wrong one.
  test('opens the redrive confirmation in place of the buttons', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(1)
    expect($('[data-testid="event-actions"]')).toHaveLength(0)
    expect($('[data-testid="event-park-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-unpark-confirm"]')).toHaveLength(0)
  })

  test('says nothing about parking anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-parked"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Park')
    expect($('main').html()).not.toContain('/park')
    expect($('main').html()).not.toContain('/unpark')
  })

  test.each([
    'parked=1',
    'unparked=1',
    'park_conflict=COMPLETED',
    'park_error=missing'
  ])('refuses the leftover %s parameter', async (query) => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: `${path}?${query}`,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('warns above the buttons when a redrive already failed the same way', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts, lastRedrive }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-futile-warning')).toBe(
      'A previous redrive (by Ada Lovelace, 2026-06-16T10:10:00Z) failed with the identical error — redriving again is unlikely to succeed until the underlying cause is fixed.'
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

  // A hop that has not finished has no duration, and a zero there would read as
  // an instant one — so the dash is the page's own answer to a null `took`.
  test('says how long each journey hop took, and dashes one still running', async () => {
    givenEvent(detail(), [
      journeyHop({ took: '1.2s' }),
      journeyHop({ id: '665f1c2e9a1b2c3d4e5f6a7c', took: null })
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

    // `Started`, not `Created`: the column is when this hop's box took the
    // message, which on an inbox hop is not when the event was created.
    expect(
      $('[data-testid="event-journey"] th')
        .toArray()
        .map((cell) => $(cell).text())
    ).toEqual(['Queue', 'Status', 'Took', 'Started'])
  })

  // A hop is timed by its own box's clock, and the endpoint measures it: a
  // slow producer leg is not booked to the consumer.
  test('starts an inbox hop at the instant its own box took the message', async () => {
    givenEvent(detail(), [
      journeyHop({
        box: 'inbox',
        hop: 'GAS Inbox',
        startedAt: '2026-06-16T10:00:00.000Z',
        took: '2.0s'
      })
    ])

    const { $ } = await viewPage()

    expect(valueOf($, 'event-journey-took')).toBe('2.0s')
    expect(valueOf($, 'event-journey-created')).toBe('2026-06-16T10:00:00Z')
  })

  test('says what the Took column is measuring', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-journey-took"]').attr('title')).toContain(
      'from when its box took it to when that box finished with it'
    )
  })
})
