import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { RedriveResult } from '../use-cases/redrive-event.use-case.ts'
import { redriveEventUseCase } from '../use-cases/redrive-event.use-case.ts'

vi.mock(import('../use-cases/redrive-event.use-case.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}/redrive`
const page = `/dev-ops/events/gas/outbox/${id}`

const givenOutcome = (outcome: RedriveResult['outcome'], status = null) =>
  vi.mocked(redriveEventUseCase).mockResolvedValue({ outcome, status })

const redrive = async (payload: Record<string, string> = {}, url = path) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials }
  })

let server: Server

describe('redriveEventRoute', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register([devOps])
    await server.initialize()
  })

  beforeEach(() => {
    givenOutcome('redriven')
  })

  afterAll(async () => {
    await server.stop()
  })

  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(redriveEventUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: path,
      payload: {},
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(redriveEventUseCase).not.toHaveBeenCalled()
  })

  test('asks the use case to redrive the event at this address', async () => {
    await redrive()

    expect(redriveEventUseCase).toHaveBeenCalledTimes(1)
    expect(redriveEventUseCase).toHaveBeenCalledWith(
      { service: 'gas', box: 'outbox', id },
      'Ada Lovelace'
    )
  })

  test.each([
    [
      'a service it does not know',
      `/dev-ops/events/other/outbox/${id}/redrive`
    ],
    ['a box it does not know', `/dev-ops/events/gas/sideways/${id}/redrive`],
    ['an id that is not an object id', '/dev-ops/events/gas/outbox/x/redrive']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await redrive({}, url)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(redriveEventUseCase).not.toHaveBeenCalled()
  })

  // 303, so the browser follows with a GET: a reload of the page that lands
  // must never re-submit a write that queues a message.
  test('redirects back to the event with a success flag', async () => {
    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?redriven=1`)
  })

  test('redirects with the status that refused the redrive', async () => {
    givenOutcome('conflict', 'RESUBMITTED' as never)

    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?redrive_conflict=RESUBMITTED`)
  })

  test('redirects on a conflict whose body named no status', async () => {
    givenOutcome('conflict')

    const { headers } = await redrive()

    expect(headers.location).toBe(`${page}?redrive_conflict=`)
  })

  test('redirects with a missing flag when the backend has no such event', async () => {
    givenOutcome('not-found')

    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?redrive_error=missing`)
  })

  test('redirects with a failure flag when the backend could not be reached', async () => {
    givenOutcome('unavailable')

    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?redrive_error=failed`)
  })

  // The operator started on a filtered list, and the page they land on has to
  // keep the way back to it.
  test('carries the list query through the write', async () => {
    const { headers } = await redrive({
      from: '?status=DEAD_LETTER&cursor=END'
    })

    expect(headers.location).toBe(
      `${page}?from=%3Fstatus%3DDEAD_LETTER%26cursor%3DEND&redriven=1`
    )
  })

  test('carries the list query through a conflict too', async () => {
    givenOutcome('conflict', 'COMPLETED' as never)

    const { headers } = await redrive({ from: '?status=DEAD_LETTER' })

    expect(headers.location).toBe(
      `${page}?from=%3Fstatus%3DDEAD_LETTER&redrive_conflict=COMPLETED`
    )
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com'],
    ['a value that is not a query string', '/dev-ops/events']
  ])('drops %s rather than redirecting through it', async (_name, from) => {
    const { headers } = await redrive({ from })

    expect(headers.location).toBe(`${page}?redriven=1`)
  })

  test('accepts a form that sent no fields at all', async () => {
    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?redriven=1`)
  })

  test('refuses a field the form does not have', async () => {
    const { statusCode } = await redrive({ from: '?a=b', confirm: 'yes' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(redriveEventUseCase).not.toHaveBeenCalled()
  })

  // The page is a GET; the write is the POST. Neither answers the other's
  // method, so a link can never write and a form can never be bookmarked.
  test('answers no GET at the redrive address', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: path,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})
