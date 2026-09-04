import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type {
  BatchEvent,
  EventDetail
} from '../use-cases/get-batch-events.use-case.ts'
import { getBatchEventsUseCase } from '../use-cases/get-batch-events.use-case.ts'
import type { RedriveBatchItem } from '../use-cases/redrive-event.use-case.ts'
import { redriveEventsUseCase } from '../use-cases/redrive-event.use-case.ts'

vi.mock(import('../use-cases/get-batch-events.use-case.ts'))
vi.mock(import('../use-cases/redrive-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/events/redrive-batch'

/** Twenty-four hex characters, as an ObjectId is and as the route insists. */
const objectId = (suffix: string) =>
  `665f1c2e9a1b2c3d4e5f${suffix.padStart(4, '0')}`

const one = objectId('1')
const two = objectId('2')

const detail = (overrides: Partial<EventDetail> = {}): EventDetail =>
  ({
    service: 'gas',
    box: 'outbox',
    id: one,
    eventId: '3f2c1a0e-1111-2222-3333-444455556666',
    type: 'case.status.updated',
    fullType: 'cloud.defra.prd.fg-gas-backend.case.update.status',
    source: null,
    target: 'gas__sns__update_case_status_fifo',
    segregationRef: 'GLD-9B2-BWS-grasslands',
    status: 'DEAD_LETTER',
    attempts: 5,
    maxAttempts: 5,
    traceId: null,
    createdAt: '2026-06-16T10:00:00.000Z',
    lastFailureAt: '2026-06-16T10:16:05.000Z',
    completedAt: null,
    lastError: null,
    attemptHistory: [],
    payload: null,
    targetRaw: null,
    messageId: null,
    traceparent: null,
    publicationDate: null,
    completionDate: null,
    lastResubmissionDate: null,
    claimedAt: null,
    claimExpiresAt: null,
    ...overrides
  }) as EventDetail

const key = (id: string) => ({ service: 'gas', box: 'outbox', id })

const givenBatch = (
  events: BatchEvent[] = [{ key: key(one), event: detail() }]
) => vi.mocked(getBatchEventsUseCase).mockResolvedValue(events)

const givenResults = (items: RedriveBatchItem[]) =>
  vi.mocked(redriveEventsUseCase).mockResolvedValue(items)

const post = async (
  payload: Record<string, unknown>,
  url = path,
  auth = { strategy: 'session', credentials }
) => {
  const { result, statusCode } = await server.inject({
    method: 'POST',
    url,
    payload,
    auth
  })

  return { $: load(result as unknown as string), statusCode }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const textsOf = ($: ReturnType<typeof load>, testId: string) =>
  $(`[data-testid="${testId}"]`)
    .toArray()
    .map((node) => flatten($(node).text()))

let server: Server

describe('redriveBatchRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenBatch()
    givenResults([
      { key: key(one), result: { outcome: 'redriven', status: null } }
    ])
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: { id: `gas:outbox:${one}` }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(getBatchEventsUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await post({ id: `gas:outbox:${one}` }, path, {
      strategy: 'session',
      credentials: {
        user: { name: 'Ada Lovelace' },
        scope: ['FCP.GrantApplicationsAdmin']
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(getBatchEventsUseCase).not.toHaveBeenCalled()
  })

  // The page is a GET; both stages of the write are POSTs. Neither answers the
  // other's method, so nothing here can be bookmarked or reloaded into a write.
  test('answers no GET at the batch address', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: path,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('reads every selected event before confirming anything', async () => {
    await post({ id: [`gas:outbox:${one}`, `caseworking:inbox:${two}`] })

    expect(getBatchEventsUseCase).toHaveBeenCalledWith([
      { service: 'gas', box: 'outbox', id: one },
      { service: 'caseworking', box: 'inbox', id: two }
    ])
    expect(redriveEventsUseCase).not.toHaveBeenCalled()
  })

  test('accepts a single selection as well as a list of them', async () => {
    await post({ id: `gas:outbox:${one}` })

    expect(getBatchEventsUseCase).toHaveBeenCalledWith([key(one)])
  })

  // A checkbox carries one value and a retry storm is one thing an operator
  // wants to act on, so a group's box carries every member's address.
  test('expands a group selection into each of its members', async () => {
    await post({ id: `gas:outbox:${one},caseworking:inbox:${two}` })

    expect(getBatchEventsUseCase).toHaveBeenCalledWith([
      { service: 'gas', box: 'outbox', id: one },
      { service: 'caseworking', box: 'inbox', id: two }
    ])
  })

  // The cap is on what the values add up to, not on how many boxes were
  // ticked: eight groups of eight is not eight events.
  test('refuses more than twenty events, however they were selected', async () => {
    const ids = Array.from({ length: 21 }, (_, index) =>
      objectId(String(index + 1))
    ).map((id) => `gas:outbox:${id}`)

    const { statusCode } = await post({ id: ids })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getBatchEventsUseCase).not.toHaveBeenCalled()
  })

  test('refuses a single group value that adds up to more than twenty', async () => {
    const ids = Array.from({ length: 21 }, (_, index) =>
      objectId(String(index + 1))
    ).map((id) => `gas:outbox:${id}`)

    const { statusCode } = await post({ id: ids.join(',') })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('accepts a selection of exactly twenty', async () => {
    const ids = Array.from({ length: 20 }, (_, index) =>
      objectId(String(index + 1))
    ).map((id) => `gas:outbox:${id}`)

    const { statusCode } = await post({ id: ids })

    expect(statusCode).toBe(statusCodes.ok)
    expect(vi.mocked(getBatchEventsUseCase).mock.calls[0][0]).toHaveLength(20)
  })

  test('refuses a form that selected nothing at all', async () => {
    const { statusCode } = await post({ from: '' })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('refuses a field the form does not have', async () => {
    const { statusCode } = await post({
      id: `gas:outbox:${one}`,
      confirm: 'yes'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  // A malformed value is not something an operator can be told about, and a
  // 400 would lose the whole selection over one bad string.
  test.each([
    ['a service it does not know', `other:outbox:${one}`],
    ['a box it does not know', `gas:sideways:${one}`],
    ['an id that is not an object id', 'gas:outbox:x'],
    ['a value that is not an address at all', 'nonsense']
  ])('drops %s and keeps the rest of the selection', async (_name, bad) => {
    await post({ id: [bad, `gas:outbox:${one}`] })

    expect(getBatchEventsUseCase).toHaveBeenCalledWith([key(one)])
  })

  // No zone label here either: the confirmation lists rows the same way the
  // table does, and every instant this app draws is UTC.
  test('writes no UTC label anywhere on the confirmation', async () => {
    givenBatch([{ key: key(one), event: detail() }])

    const { $ } = await post({ id: `gas:outbox:${one}` })

    expect($('main').html()).not.toContain('UTC')
  })

  test('names every selected event on the confirmation', async () => {
    givenBatch([
      { key: key(one), event: detail() },
      {
        key: key(two),
        event: detail({ id: two, type: 'case.created', eventId: 'other-id' })
      }
    ])

    const { $ } = await post({ id: [`gas:outbox:${one}`, `gas:outbox:${two}`] })

    expect(textsOf($, 'events-batch-type')).toEqual([
      'case.status.updated',
      'case.created'
    ])
    expect(textsOf($, 'events-batch-id')).toEqual([
      '3f2c1a0e-1111-2222-3333-444455556666',
      'other-id'
    ])
    expect(textsOf($, 'events-batch-queue')).toEqual([
      'GAS · Outbox · to Caseworking',
      'GAS · Outbox · to Caseworking'
    ])
    expect($('[data-testid="events-batch-title"]').text()).toBe(
      'Redrive 2 events?'
    )
  })

  // A row that stores no type at all — an audit record — is named the way the
  // list names it: by its id, with no type line under it. That is a different
  // fact from a row we could not read, which says so in words.
  test('names a null-typed event by its id alone, with no type line', async () => {
    givenBatch([
      { key: key(one), event: detail({ type: null, fullType: null }) }
    ])

    const { $ } = await post({ id: `gas:outbox:${one}` })

    expect(textsOf($, 'events-batch-id')).toEqual([
      '3f2c1a0e-1111-2222-3333-444455556666'
    ])
    expect($('[data-testid="events-batch-type"]')).toHaveLength(0)
    expect($('[data-testid="events-batch-unknown"]')).toHaveLength(0)
    expect($('[data-testid="events-batch-row"]').text()).not.toContain('n/a')
  })

  // A row that could not be read is still redriven — the write is by address —
  // so it is listed and says so rather than vanishing from a page an operator
  // is reading precisely to check what they selected.
  test('lists an event it could not read, and says it could not', async () => {
    givenBatch([{ key: key(one), event: null }])

    const { $ } = await post({ id: `gas:outbox:${one}` })

    expect(textsOf($, 'events-batch-type')).toEqual(['—'])
    expect(textsOf($, 'events-batch-id')).toEqual([one])
    expect(textsOf($, 'events-batch-unknown')).toEqual(['could not be read'])
  })

  test('carries every selection into the confirmation form', async () => {
    givenBatch([
      { key: key(one), event: detail() },
      { key: key(two), event: detail({ id: two }) }
    ])

    const { $ } = await post({
      id: `gas:outbox:${one},gas:outbox:${two}`,
      from: '?status=DEAD_LETTER'
    })

    const form = $('[data-testid="events-batch-confirm-form"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(
      '/dev-ops/events/redrive-batch?confirmed=1'
    )
    expect(
      $('[data-testid="events-batch-confirm-id"]')
        .toArray()
        .map((field) => $(field).attr('value'))
    ).toEqual([`gas:outbox:${one}`, `gas:outbox:${two}`])
    expect($('[data-testid="events-batch-confirm-from"]').attr('value')).toBe(
      '?status=DEAD_LETTER'
    )
  })

  test('offers the way back to the list the operator came from', async () => {
    const { $ } = await post({
      id: `gas:outbox:${one}`,
      from: '?status=DEAD_LETTER&cursor=END'
    })

    expect($('[data-testid="events-batch-back"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&cursor=END'
    )
    expect($('[data-testid="events-batch-cancel"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&cursor=END'
    )
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com'],
    ['a value that is not a query string', '/dev-ops/events']
  ])('drops %s rather than linking through it', async (_name, from) => {
    const { $ } = await post({ id: `gas:outbox:${one}`, from })

    expect($('[data-testid="events-batch-back"]').attr('href')).toBe(
      '/dev-ops/events'
    )
  })

  test('says nothing was selected when nothing survived the address check', async () => {
    givenBatch([])

    const { $, statusCode } = await post({ id: 'nonsense' })

    expect(statusCode).toBe(statusCodes.ok)
    expect(flatten($('[data-testid="events-batch-empty"]').text())).toBe(
      'No events were selected. Nothing has been redriven.'
    )
    expect($('[data-testid="events-batch-confirm-form"]')).toHaveLength(0)
  })

  test('redrives every confirmed event, and only once confirmed', async () => {
    await post(
      { id: [`gas:outbox:${one}`, `gas:outbox:${two}`] },
      `${path}?confirmed=1`
    )

    expect(redriveEventsUseCase).toHaveBeenCalledWith(
      [key(one), key(two)],
      'Ada Lovelace'
    )
    expect(getBatchEventsUseCase).not.toHaveBeenCalled()
  })

  // Every outcome side by side, because "3 of 8 succeeded" leaves an operator
  // to go and find out which three.
  test('reports each outcome on its own line', async () => {
    givenResults([
      { key: key(one), result: { outcome: 'redriven', status: null } },
      {
        key: key(two),
        result: { outcome: 'conflict', status: 'COMPLETED' }
      },
      {
        key: key(objectId('3')),
        result: { outcome: 'not-found', status: null }
      },
      {
        key: key(objectId('4')),
        result: { outcome: 'unavailable', status: null }
      }
    ])

    const { $ } = await post({ id: `gas:outbox:${one}` }, `${path}?confirmed=1`)

    expect(textsOf($, 'do-status-label')).toEqual([
      'Resubmitted',
      'Conflict (Completed)',
      'Not found',
      'Error'
    ])
    expect(textsOf($, 'events-batch-result-detail')).toEqual([
      'Back on the queue — the poller will retry it.',
      'Not redriven — this event is no longer dead-lettered. Its status is now Completed.',
      'Not redriven — fg-gas-backend no longer has this event.',
      'Not redriven — fg-gas-backend could not be reached.'
    ])
    expect($('[data-testid="events-batch-results-title"]').text()).toBe(
      'Redrove 1 of 4 events'
    )
  })

  test('links each result at the event it is about', async () => {
    const { $ } = await post({ id: `gas:outbox:${one}` }, `${path}?confirmed=1`)

    expect($('[data-testid="events-batch-result-id"]').attr('href')).toBe(
      `/dev-ops/events/gas/outbox/${one}`
    )
    expect(textsOf($, 'events-batch-result-source')).toEqual(['GAS · Outbox'])
  })

  test('offers the way back to the list from the results', async () => {
    const { $ } = await post(
      { id: `gas:outbox:${one}`, from: '?status=DEAD_LETTER' },
      `${path}?confirmed=1`
    )

    expect($('[data-testid="events-batch-results-back"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER'
    )
  })
})
