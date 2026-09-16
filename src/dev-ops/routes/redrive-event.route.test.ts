import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
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
const anotherPage = '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7c'

const xss = '<script>alert(1)</script>'

const event: EventDetail = {
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  targetTopic: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { id: '3f2c1a0e' },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null
}

/**
 * `status` is the LABEL — the words fg-gas-backend spells the state in,
 * read off the 409 body and passed through this route untranslated, so the
 * banner on the page that lands says what the backend said.
 */
const givenOutcome = (
  outcome: RedriveResult['outcome'],
  status: RedriveResult['status'] = null
) => vi.mocked(redriveEventUseCase).mockResolvedValue({ outcome, status })

const redrive = async (payload: Record<string, string> = {}, url = path) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials }
  })

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

/** The event page the browser is sent to, carrying only the session cookie. */
const follow = async (cookie: string, url = page) => {
  const { result } = await server.inject({
    method: 'GET',
    url,
    headers: { cookie },
    auth: { strategy: 'session', credentials }
  })

  return load(result as unknown as string)('[data-testid="event-banner"]')
}

/** The write, then the page it redirects to, exactly as a browser does it. */
const redriveAndFollow = async (payload: Record<string, string> = {}) => {
  const written = await redrive(payload)
  const cookie = sessionCookie(written)

  return { cookie, banner: await follow(cookie) }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenOutcome('redriven')
  vi.mocked(getEventUseCase).mockResolvedValue({ outcome: 'found', event })
})

afterAll(async () => {
  await server.stop()
})

describe('redriveEventRoute', () => {
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
  //
  // Nothing about the outcome is in the url: it would survive every refresh of
  // the page that lands, repeating a message about one write for as long as the
  // tab stayed open.
  test('redirects back to the event and says nothing in the url', async () => {
    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
  })

  // The operator started on a filtered list, and the page they land on has to
  // keep the way back to it.
  test('carries the list query through the write', async () => {
    const { headers } = await redrive({
      from: '?status=DEAD_LETTER&cursor=END'
    })

    expect(headers.location).toBe(
      `${page}?from=%3Fstatus%3DDEAD_LETTER%26cursor%3DEND`
    )
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com'],
    ['a value that is not a query string', '/dev-ops/events']
  ])('drops %s rather than redirecting through it', async (_name, from) => {
    const { headers } = await redrive({ from })

    expect(headers.location).toBe(page)
  })

  test('accepts a form that sent no fields at all', async () => {
    const { statusCode, headers } = await redrive()

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
  })

  // hapi hands a POST with no body at all a payload of `null`, and a Joi
  // default only fires on `undefined` - so the "sent no fields" case above,
  // which posts `{}`, was the only one that ever worked. This is the one an
  // operator with scripting off actually sends.
  test('accepts a post with no body at all', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
  })

  // Echoed into the redirect, so it is bounded.
  test('refuses a from longer than any query this app writes', async () => {
    const { statusCode } = await redrive({ from: `?q=${'x'.repeat(2100)}` })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(redriveEventUseCase).not.toHaveBeenCalled()
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

/**
 * The write and the page it lands on, carrying only the session cookie between
 * them: the outcome travels server-side, so what these assert is the journey
 * rather than a parameter halfway along it.
 */
describe('the message a redrive leaves behind', () => {
  test.each([
    ['redriven', null, 'alert-success', 'Redrive requested — status is now'],
    [
      'conflict',
      'Resubmitted',
      'alert-warning',
      'Its status is now Resubmitted.'
    ],
    ['not-found', null, 'alert-error', 'no longer has this event'],
    ['timed-out', null, 'alert-warning', 'Redrive status unknown'],
    ['unavailable', null, 'alert-error', 'could not be reached']
  ] as const)('says a %s outcome', async (outcome, status, role, said) => {
    givenOutcome(outcome, status)

    const { banner } = await redriveAndFollow()

    expect(banner.attr('class')).toContain(role)
    expect(flatten(banner.text())).toContain(said)
  })

  test('escapes a conflicting status carrying markup', async () => {
    givenOutcome('conflict', xss)

    const { banner } = await redriveAndFollow()

    expect(banner.find('script')).toHaveLength(0)
    expect(banner.text()).toContain(xss)
  })

  test('is gone by the next refresh of the page', async () => {
    const { cookie } = await redriveAndFollow()

    expect(await follow(cookie)).toHaveLength(0)
  })

  // The redirect need not land: the tab is closed, or another event is opened
  // first, and a message about one redrive must not appear on someone else's.
  test('is dropped, not moved, when another event is opened first', async () => {
    const cookie = sessionCookie(await redrive())

    expect(await follow(cookie, anotherPage)).toHaveLength(0)
    expect(await follow(cookie)).toHaveLength(0)
  })

  test('reaches the page the operator is sent back to with a list query on it', async () => {
    const written = await redrive({ from: '?status=DEAD_LETTER' })
    const banner = await follow(
      sessionCookie(written),
      `${page}?from=%3Fstatus%3DDEAD_LETTER`
    )

    expect(banner.attr('class')).toContain('alert-success')
  })
})
