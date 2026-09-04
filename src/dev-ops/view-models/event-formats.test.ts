import type {
  Event,
  EventBox,
  EventService
} from '../use-cases/get-events.use-case.ts'
import { toQueue, toRoute } from './event-formats.ts'

/**
 * The vocabulary both event pages read from, tested where it lives.
 *
 * `toRoute` is the single-event page's Route fact — `GAS → Caseworking (via
 * gas__sns__update_case_status_fifo)` — and the consumer map underneath it is
 * the reason that sentence is true rather than a guess off a topic's prefix.
 * `toQueue` is what the *list* draws instead: which hop a row is, and the
 * queue name an operator pastes somewhere else. Both are exercised against the
 * same events, in one file, because the two pages have to keep agreeing about
 * what a topic means.
 */
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
  traceId: null,
  ...overrides
})

const routeFor = (overrides: Partial<Event> = {}) => toRoute(event(overrides))

const queueFor = (overrides: Partial<Event> = {}) => toQueue(event(overrides))

/**
 * The Route fact's two names, rejoined by the arrow the template puts back
 * between them, so each assertion below reads as the page reads.
 */
const routeOf = (overrides: Partial<Event> = {}) => {
  const { routeFrom, routeTo, routeDetail } = routeFor(overrides)

  return { headline: `${routeFrom} → ${routeTo}`, detail: routeDetail }
}

describe('toRoute', () => {
  // And an outbox row's line two is the topic alone — the arrow already says
  // the message left, so the word `outbox` was only taking room from it.
  test('reads a GAS outbox row bound for Caseworking as the hop it is', () => {
    expect(
      routeOf({
        service: 'gas',
        box: 'outbox',
        source: null,
        target: 'gas__sns__update_case_status_fifo'
      })
    ).toEqual({
      headline: 'GAS → Caseworking',
      detail: 'via gas__sns__update_case_status_fifo'
    })
  })

  // The arrow lives in the template, muted, so it never reads as loudly as the
  // two names it joins.
  test('names each end of the route on its own', () => {
    expect(routeFor()).toMatchObject({
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
        target: 'cw__sns__case_status_updated_fifo.fifo'
      })
    ).toEqual({
      headline: 'Caseworking → GAS',
      detail: 'via cw__sns__case_status_updated_fifo.fifo'
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

  // The bug this map exists to kill. Topics are named for whoever *publishes*
  // them, so reading the destination off the prefix turned every real hop into
  // a self-route: the message that makes Caseworking open a case read
  // `GAS → GAS`, and so did every audit row GAS ever wrote.
  test.each([
    ['gas__sns__create_new_case_fifo.fifo', 'GAS → Caseworking'],
    ['gas__sns__update_case_status_fifo.fifo', 'GAS → Caseworking'],
    ['gas__sns__audit_topic_arn', 'GAS → Audit'],
    ['gas__sns__create_agreement_fifo.fifo', 'GAS → Agreements'],
    ['gas__sns__update_agreement_status_fifo.fifo', 'GAS → Agreements'],
    ['gas__sns__create_payment_fifo.fifo', 'GAS → Payments'],
    ['agreement_status_updated_fifo.fifo', 'GAS → GAS']
  ])('routes %s to the service that consumes it', (target, headline) => {
    expect(routeOf({ target }).headline).toBe(headline)
  })

  // Caseworking's own topics are consumed elsewhere too, and the `cw__` prefix
  // that used to answer this question said Caseworking to both of them.
  test.each([
    ['cw__sns__case_status_updated_fifo.fifo', 'Caseworking → GAS'],
    ['cw__sns__audit_topic_arn', 'Caseworking → Audit']
  ])('routes %s away from its publisher', (target, headline) => {
    expect(
      routeOf({ service: 'caseworking', source: null, target }).headline
    ).toBe(headline)
  })

  // One topic is spelled three ways across the estate — ARN, bare name, and
  // the `_fifo` some names carry with no `.fifo` after it — and all three name
  // the same subscription.
  test.each([
    'gas__sns__create_new_case_fifo.fifo',
    'create_new_case_fifo.fifo',
    'gas__sns__create_new_case_fifo',
    'create_new_case'
  ])('finds the same consumer however %s is spelled', (target) => {
    expect(routeFor({ target }).routeTo).toBe('Caseworking')
    expect(routeFor({ target }).routeToIsTopic).toBe(false)
  })

  // Payments and Agreements are reached through topics with no service prefix
  // at all, which the old prefix rule could only render as raw strings.
  test('names an unprefixed topic by its consumer', () => {
    expect(routeOf({ target: 'create_payment.fifo' })).toEqual({
      headline: 'GAS → Payments',
      detail: 'via create_payment.fifo'
    })
  })

  // A subscription nobody in the platform's config declares is still a topic
  // worth reading, so it keeps the topic-as-destination rendering rather than
  // being guessed at from its prefix.
  test.each([
    'gas__sns__grant_application_created_fifo.fifo',
    'gas__sns__application_status_updated_fifo.fifo',
    'cw__sns__case_created_fifo.fifo'
  ])('leaves %s as the destination, having no consumer for it', (target) => {
    const row = routeFor({ target })

    expect(row.routeToIsTopic).toBe(true)
    expect(row.routeToTitle).toBe(target)
    expect(row.routeDetail).toBe(`via ${target}`)
  })

  // The suffix is the whole topic, raw. This page has one row on it and no
  // column widths to fight, so nothing here is ever cut.
  test('quotes the topic on the suffix exactly as it is stored', () => {
    expect(
      routeFor({ target: 'gas__sns__update_case_status_fifo' }).routeDetail
    ).toBe('via gas__sns__update_case_status_fifo')
    expect(
      routeFor({ target: 'gas__sns__update_agreement_status_fifo.fifo' })
        .routeDetail
    ).toBe('via gas__sns__update_agreement_status_fifo.fifo')
  })

  // An inbox row names the box it is sitting in: a lone `inbox` said nothing
  // the arrow above it had not already said.
  test('names the box an inbox row is sitting in', () => {
    expect(
      routeFor({ box: 'inbox', source: 'CW', target: null }).routeDetail
    ).toBe('gas inbox')
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
    const row = routeFor({ target: 'grant_application_created_fifo' })

    expect(row.routeTo).toBe('grant_application_created_fifo')
    expect(row.routeToIsTopic).toBe(true)
    expect(row.routeToTitle).toBe('grant_application_created_fifo')
  })

  // Only the transport prefix goes: it names the service and the queue type,
  // both of which the sentence in front of the arrow has already said.
  test('strips the transport prefix off a topic it puts on the arrow', () => {
    expect(routeFor({ target: 'legacy__sqs__old_queue' }).routeTo).toBe(
      'old_queue'
    )
    expect(routeFor({ target: 'legacy__sqs__old_queue' }).routeToTitle).toBe(
      'legacy__sqs__old_queue'
    )
  })

  // A route that points at a service we do name is a sentence, not a string:
  // it keeps the full name and keeps its parenthetical.
  test('leaves a recognised destination alone, suffix and all', () => {
    const row = routeFor({ target: 'gas__sns__update_case_status_fifo' })

    expect(row.routeTo).toBe('Caseworking')
    expect(row.routeToIsTopic).toBe(false)
    expect(row.routeToTitle).toBeNull()
    expect(row.routeDetail).toBe('via gas__sns__update_case_status_fifo')
  })

  test('says unknown when an outbox row names no target at all', () => {
    expect(routeOf({ target: null })).toEqual({
      headline: 'GAS → unknown',
      detail: 'via -'
    })
    expect(routeFor({ target: null }).routeToIsTopic).toBe(false)
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
})

/**
 * What the *list* draws in place of that sentence. Producer → consumer is a
 * fact a developer derives once and then knows; a list of twenty rows is read
 * for which hop each row is and which queue it names, and those are the two
 * things the arrow sentence left out.
 */
describe('toQueue', () => {
  // The same words the journey table uses, from the same call: a row and the
  // page it opens must not grow two vocabularies for one fact.
  test('names the hop as the journey table names it', () => {
    expect(queueFor().hop).toBe('GAS · Outbox')
    expect(queueFor({ service: 'caseworking' }).hop).toBe('CW · Outbox')
    expect(queueFor({ box: 'inbox', source: 'CW' }).hop).toBe('GAS · Inbox')
    expect(
      queueFor({ service: 'caseworking', box: 'inbox', source: 'GAS' }).hop
    ).toBe('CW · Inbox')
  })

  // Line two names the service at the other end, so the column reads as one
  // vocabulary of hops in both directions: `to Caseworking` above, `from GAS`
  // below. It used to print the topic token, which is a machine string beside
  // a sentence and says nothing about where the message actually went.
  //
  // The destination comes from the same subscription map the detail page's
  // Route uses, so a row and the page it opens cannot say different things.
  test('names where an outbox row went, in the words the Route uses', () => {
    expect(
      queueFor({ target: 'gas__sns__update_case_status_fifo' }).queue
    ).toBe('to Caseworking')
    expect(
      queueFor({ target: 'cw__sqs__create_new_case_fifo.fifo' }).queue
    ).toBe('to Caseworking')
  })

  // A topic no subscription in the platform's config names has no service on
  // the far end, so it names itself — the normalised topic, which is the key
  // the map was searched under, rather than the raw prefixed token that only
  // repeats the hop above it.
  test.each([
    ['gas__sns__update_agreement_status_fifo.fifo', 'to Agreements'],
    [
      'gas__sns__grant_application_created_fifo.fifo',
      'to grant_application_created'
    ],
    ['gas__sqs__audit_topic_arn', 'to Audit'],
    ['audit', 'to Audit'],
    ['create_payment.fifo', 'to Payments'],
    ['sqs__legacy_queue', 'to sqs__legacy_queue']
  ])('reads %s as %s', (target, queue) => {
    expect(queueFor({ target }).queue).toBe(queue)
  })

  // `internal` never leaves the service that wrote it, which is exactly what
  // the detail Route says of it: `GAS → GAS (via internal)`.
  test('names an internal hop as the service that wrote it', () => {
    expect(queueFor({ target: 'internal' }).queue).toBe('to GAS')
    expect(queueFor({ service: 'caseworking', target: 'internal' }).queue).toBe(
      'to Caseworking'
    )
  })

  // An audit row is the commonest thing on the stream and the one the arrow
  // sentence said least about: it is a GAS outbox write onto the audit topic.
  test('reads an audit row as a GAS outbox write onto the audit topic', () => {
    const cell = queueFor({ target: 'audit_topic_arn' })

    expect(cell.hop).toBe('GAS · Outbox')
    expect(cell.queue).toBe('to Audit')
  })

  // The clipboard gets the target exactly as it is stored — a whole ARN where
  // that is what arrived — because the shown value has had a prefix taken off
  // it and half an ARN pasted into a console is worse than none.
  test('copies the raw target, prefix and all', () => {
    expect(
      queueFor({ target: 'gas__sns__update_case_status_fifo' }).queueValue
    ).toBe('gas__sns__update_case_status_fifo')
  })

  // An inbox row has no topic — it is a message sitting in a box — so line two
  // names the producer instead, which is the counterpart the hop cannot say.
  test.each([
    ['GAS', 'from GAS'],
    ['CW', 'from Caseworking'],
    ['AS', 'from Agreements'],
    ['PAY', 'from Payments'],
    [null, 'from unknown']
  ])('names the producer of an inbox row from %s', (source, queue) => {
    expect(queueFor({ box: 'inbox', source, target: null }).queue).toBe(queue)
  })

  // `from GAS` is a sentence, not a value: there is nothing there to paste.
  test('offers nothing to copy on an inbox row', () => {
    expect(
      queueFor({ box: 'inbox', source: 'GAS', target: null }).queueValue
    ).toBeNull()
  })

  // An outbox row that names no target has no second line at all, rather than
  // a line saying `-` twenty times down a page.
  test('draws no queue line for an outbox row with no target', () => {
    expect(queueFor({ target: null })).toEqual({
      hop: 'GAS · Outbox',
      queue: null,
      queueValue: null
    })
  })

  // `status` already proves the endpoint can pass a value through that this
  // app has no label for. A service or a box it widens to must read as itself
  // rather than vanishing from the column.
  test('names a service and a box it has no label for as the endpoint did', () => {
    expect(
      queueFor({
        service: 'reporting' as unknown as EventService,
        box: 'deadletter' as unknown as EventBox,
        source: 'GAS',
        target: null
      }).hop
    ).toBe('reporting · deadletter')
  })
})
