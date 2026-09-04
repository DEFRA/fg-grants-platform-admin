import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { ParkResult } from '../use-cases/park-event.use-case.ts'
import {
  parkEventUseCase,
  unparkEventUseCase
} from '../use-cases/park-event.use-case.ts'

vi.mock(import('../use-cases/park-event.use-case.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const parkPath = `/dev-ops/events/gas/outbox/${id}/park`
const unparkPath = `/dev-ops/events/gas/outbox/${id}/unpark`
const page = `/dev-ops/events/gas/outbox/${id}`
const key = { service: 'gas', box: 'outbox', id }

const reason = 'duplicate key on a case that no longer exists'

const givenOutcome = (outcome: ParkResult['outcome'], status = null) => {
  vi.mocked(parkEventUseCase).mockResolvedValue({ outcome, status })
  vi.mocked(unparkEventUseCase).mockResolvedValue({ outcome, status })
}

const post = async (
  url: string,
  payload: Record<string, string> = {},
  scope = ['FCP.GrantOperationsAdmin']
) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials: { ...credentials, scope } }
  })

let server: Server

describe('parkEventRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenOutcome('parked')
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: parkPath,
      payload: { reason }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(parkEventUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await post(parkPath, { reason }, [
      'FCP.GrantApplicationsAdmin'
    ])

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(parkEventUseCase).not.toHaveBeenCalled()
  })

  // The reason, the address, and the person who asked: a park with any of the
  // three missing is a park nobody can account for later.
  test('parks the event, with the reason and the operator', async () => {
    await post(parkPath, { reason })

    expect(parkEventUseCase).toHaveBeenCalledTimes(1)
    expect(parkEventUseCase).toHaveBeenCalledWith(key, reason, 'Ada Lovelace')
  })

  // A parked event with no reason is an event that has silently left the
  // dead-letter count, which is worse than one nobody parked at all.
  test.each([
    ['no reason at all', {}],
    ['an empty reason', { reason: '' }],
    ['a reason of nothing but spaces', { reason: '   ' }]
  ])('refuses a park with %s', async (_name, payload) => {
    const { statusCode } = await post(parkPath, payload as never)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(parkEventUseCase).not.toHaveBeenCalled()
  })

  test('refuses a reason longer than the backend accepts', async () => {
    const { statusCode } = await post(parkPath, { reason: 'x'.repeat(513) })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(parkEventUseCase).not.toHaveBeenCalled()
  })

  test('accepts a reason at the limit', async () => {
    const { statusCode } = await post(parkPath, { reason: 'x'.repeat(512) })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(parkEventUseCase).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['a service it does not know', `/dev-ops/events/other/outbox/${id}/park`],
    ['a box it does not know', `/dev-ops/events/gas/sideways/${id}/park`],
    ['an id that is not an object id', '/dev-ops/events/gas/outbox/x/park']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await post(url, { reason })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(parkEventUseCase).not.toHaveBeenCalled()
  })

  // 303, so the browser follows with a GET: a reload of the page that lands
  // must never re-submit a write.
  test('redirects back to the event with a parked flag', async () => {
    const { statusCode, headers } = await post(parkPath, { reason })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?parked=1`)
  })

  test('keeps the list the operator came from', async () => {
    const { headers } = await post(parkPath, {
      reason,
      from: '?status=DEAD_LETTER'
    })

    expect(headers.location).toBe(
      `${page}?from=%3Fstatus%3DDEAD_LETTER&parked=1`
    )
  })

  test('drops a `from` that is not this list own query string', async () => {
    const { headers } = await post(parkPath, { reason, from: '//example.com' })

    expect(headers.location).toBe(`${page}?parked=1`)
  })

  test('redirects with the status that refused the park', async () => {
    givenOutcome('conflict', 'COMPLETED' as never)

    const { headers } = await post(parkPath, { reason })

    expect(headers.location).toBe(`${page}?park_conflict=COMPLETED`)
  })

  test.each([
    ['not-found', 'missing'],
    ['unavailable', 'failed']
  ])('redirects a %s outcome as %s', async (outcome, value) => {
    givenOutcome(outcome as ParkResult['outcome'])

    const { headers } = await post(parkPath, { reason })

    expect(headers.location).toBe(`${page}?park_error=${value}`)
  })
})

describe('unparkEventRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenOutcome('parked')
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: unparkPath,
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(unparkEventUseCase).not.toHaveBeenCalled()
  })

  // No reason, because the reason is the thing being withdrawn.
  test('unparks the event, naming the operator', async () => {
    await post(unparkPath)

    expect(unparkEventUseCase).toHaveBeenCalledTimes(1)
    expect(unparkEventUseCase).toHaveBeenCalledWith(key, 'Ada Lovelace')
  })

  test('redirects back to the event with an unparked flag', async () => {
    const { statusCode, headers } = await post(unparkPath)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?unparked=1`)
  })

  test('redirects with the status that refused the unpark', async () => {
    givenOutcome('conflict', 'RESUBMITTED' as never)

    const { headers } = await post(unparkPath)

    expect(headers.location).toBe(`${page}?park_conflict=RESUBMITTED`)
  })
})
