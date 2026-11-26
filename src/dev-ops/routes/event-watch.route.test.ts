import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  EventDetail,
  EventHistoryEntry
} from '../repositories/events.repository.ts'
import {
  findEvent,
  findEventStatus,
  redriveEvent
} from '../repositories/events.repository.ts'
import { shellCatalogue } from '../use-cases/shell-catalogue.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/shell-catalogue.ts'))
vi.mock(import('../repositories/events.repository.ts'), async (original) => ({
  ...(await original()),
  findEvent: vi.fn(),
  findEventStatus: vi.fn(),
  redriveEvent: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const listPath = '/dev-ops/events/gas'

const attempt = (number: number, message: string): EventHistoryEntry => ({
  kind: 'attempt',
  at: `2026-10-13T15:0${number}:00.000Z`,
  number,
  name: 'Error',
  message,
  stack: `Error: ${message}\n    at handle (/src/a.js:1:1)`
})

const redriven: EventHistoryEntry = {
  kind: 'redriven',
  at: '2026-10-13T15:05:00.000Z',
  by: 'Ada Lovelace'
}

const received: EventHistoryEntry = {
  kind: 'received',
  at: '2026-10-13T14:53:22.397Z'
}

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'io.onsite.agreement.status.updated',
  eventType: 'AgreementStatusUpdated',
  targetTopic: null,
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-10-13T14:53:22.397Z',
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { id: 'abc' },
  payloadRevision: 3,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: { at: '2026-10-13T15:05:00.000Z', by: 'Ada Lovelace' },
  history: [attempt(7, 'boom'), redriven, attempt(4, 'boom'), received],
  ...overrides
})

const delivered = () =>
  detail({
    status: 'COMPLETED',
    statusLabel: 'Completed',
    statusRole: 'success',
    purgeDeletionDate: null,
    completionDate: '2026-10-13T15:05:01.000Z',
    history: [
      { kind: 'delivered', at: '2026-10-13T15:05:01.000Z' },
      redriven,
      attempt(4, 'boom'),
      received
    ]
  })

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const get = async (url: string, cookie = '') => {
  const response = await server.inject({
    method: 'GET',
    url,
    headers: {
      cookie: ['dev-ops-times=utc', cookie].filter(Boolean).join('; ')
    },
    auth: { strategy: 'session', credentials }
  })

  return {
    $: load(response.payload),
    payload: response.payload,
    statusCode: response.statusCode,
    cache: response.headers['cache-control'],
    type: response.headers['content-type']
  }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const bannerOf = ($: CheerioAPI) => {
  const banner = by($, 'event-banner')

  return {
    count: banner.length,
    tone: (banner.attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
    title: flat(banner.find('.gpa-alert-title').text()),
    text: flat(banner.find('.gpa-alert-body > div').first().text())
  }
}

const toastsOf = ($: CheerioAPI) =>
  by($, 'toast')
    .toArray()
    .map((toast) => flat($(toast).find('.gpa-toast-text').text()))

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(shellCatalogue).mockReturnValue(fullCatalogue)
  vi.mocked(findEvent).mockReset().mockResolvedValue(detail())
  vi.mocked(findEventStatus).mockReset()
  vi.mocked(redriveEvent).mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the status a redrive’s page checks', () => {
  test.each([
    ['RESUBMITTED', 0, false],
    ['FAILED', 2, false],
    ['COMPLETED', 1, true],
    ['DEAD_LETTER', 5, true],
    ['PURGED', 5, true]
  ])(
    '%s with %i failed: settled %s, never stored',
    async (status, failed, settled) => {
      vi.mocked(findEventStatus).mockResolvedValue({
        status,
        statusLabel: status,
        attemptsSinceRedrive: failed,
        maxAttempts: 5
      })

      const answer = await get(`${path}/status`)

      expect(answer.statusCode).toBe(statusCodes.ok)
      expect(JSON.parse(answer.payload)).toStrictEqual({
        settled,
        failed,
        allowed: 5
      })
      expect(answer.cache).toBe('no-store')
      expect(findEventStatus).toHaveBeenCalledExactlyOnceWith({
        service: 'gas',
        box: 'outbox',
        id
      })
    }
  )

  test('a check GAS doesn’t answer is a 502 with nothing in it', async () => {
    vi.mocked(findEventStatus).mockRejectedValue(new Error('ECONNREFUSED'))

    const answer = await get(`${path}/status`)

    expect(answer.statusCode).toBe(statusCodes.badGateway)
    expect(answer.payload).toBe('')
  })

  test('a CW event is asked of GAS under its own service', async () => {
    vi.mocked(findEventStatus).mockResolvedValue({
      status: 'FAILED',
      statusLabel: 'Failed',
      attemptsSinceRedrive: 1,
      maxAttempts: 3
    })

    const answer = await get(`/dev-ops/events/cw/inbox/${id}/status`)

    expect(JSON.parse(answer.payload)).toStrictEqual({
      settled: false,
      failed: 1,
      allowed: 3
    })
    expect(findEventStatus).toHaveBeenCalledExactlyOnceWith({
      service: 'caseworking',
      box: 'inbox',
      id
    })
  })
})

describe('the result a settled redrive swaps in', () => {
  test('a part of the page: the record and its dialogs, with no shell around it, never stored', async () => {
    const answer = await get(`${path}/result`)

    expect(answer.statusCode).toBe(statusCodes.ok)
    expect(answer.cache).toBe('no-store')
    expect(answer.type).toMatch(/^text\/html/)
    expect(answer.payload).not.toMatch(/<html|<head>|<body|gpa-sidebar/)
    expect(answer.$('#event-record > .gpa-page')).toHaveLength(1)
    expect(
      answer
        .$('#event-record > gpa-dialog > dialog')
        .toArray()
        .map((d) => d.attribs.id)
    ).toStrictEqual(['redrive-dialog', 'purge-dialog'])
    expect(findEvent).toHaveBeenCalledTimes(1)
  })

  test.each([
    [
      'the same error',
      [attempt(7, 'boom'), redriven, attempt(4, 'boom'), received],
      'It’s a dead letter again, with the same error.'
    ],
    [
      'a different error',
      [attempt(7, 'bang'), redriven, attempt(4, 'boom'), received],
      'It’s a dead letter again, with a different error. History shows it.'
    ],
    [
      'nothing to compare',
      [attempt(7, 'boom'), redriven, received],
      'It’s a dead letter again. History shows the error.'
    ]
  ])(
    'failed again with %s: a warning, the status and actions as they are now',
    async (_case, history, text) => {
      vi.mocked(findEvent).mockResolvedValue(detail({ history }))

      const { $ } = await get(`${path}/result`)

      expect($('#event-record').attr('data-gpa-outcome')).toBe('failed')
      expect(bannerOf($)).toStrictEqual({
        count: 1,
        tone: 'warning',
        title: 'Failed again.',
        text
      })
      expect(by($, 'event-banner').attr('id')).toBe('event-banner')
      expect(flat(by($, 'event-status').text())).toBe('Dead letter')
      expect(by($, 'event-redrive')).toHaveLength(1)
      expect(by($, 'event-purge')).toHaveLength(1)
      expect(toastsOf($)).toStrictEqual([])
    }
  )

  test('delivered: no banner, an Event delivered toast, Completed and no actions', async () => {
    vi.mocked(findEvent).mockResolvedValue(delivered())

    const { $ } = await get(`${path}/result`)

    expect($('#event-record').attr('data-gpa-outcome')).toBe('delivered')
    expect(by($, 'event-banner')).toHaveLength(0)
    expect(toastsOf($)).toStrictEqual(['Event delivered'])
    expect(flat(by($, 'event-status').text())).toBe('Completed')
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(by($, 'event-purge')).toHaveLength(0)
  })

  test('purged since it failed: no banner, an Event purged toast, and the status says it', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({
        status: 'PURGED',
        statusLabel: 'Purged',
        purgeDeletionDate: null
      })
    )

    const { $ } = await get(`${path}/result`)

    expect($('#event-record').attr('data-gpa-outcome')).toBe('purged')
    expect(by($, 'event-banner')).toHaveLength(0)
    expect(toastsOf($)).toStrictEqual(['Event purged'])
    expect(flat(by($, 'event-status').text())).toBe('Purged')
  })

  test('still on its way: no result yet, so the page keeps checking', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({
        status: 'FAILED',
        statusLabel: 'Failed',
        purgeDeletionDate: null
      })
    )

    const { $ } = await get(`${path}/result`)

    expect($('#event-record').attr('data-gpa-outcome')).toBe('waiting')
    expect(by($, 'event-banner')).toHaveLength(0)
  })

  test('History’s result is History, its count and links keeping the list it goes back to', async () => {
    const query = `?back=${encodeURIComponent(listPath)}&tab=history`
    const { $ } = await get(`${path}/result${query}`)

    expect(by($, 'event-history')).toHaveLength(1)
    expect(by($, 'event-details')).toHaveLength(0)
    expect(
      $('nav.gpa-tabs a')
        .toArray()
        .map((tab) => [flat($(tab).text()), tab.attribs.href])
    ).toStrictEqual([
      ['Overview', `${path}?back=${encodeURIComponent(listPath)}`],
      ['History4', `${path}${query}`]
    ])
    expect(by($, 'event-back').attr('href')).toBe(listPath)
  })

  test('a bad tab is the Overview, as on the page', async () => {
    const { $ } = await get(`${path}/result?tab=nonsense`)

    expect(by($, 'event-details')).toHaveLength(1)
  })

  test('spends nothing the session holds: the redrive’s banner is still there for the page', async () => {
    const posted = await server.inject({
      method: 'POST',
      url: `${path}/redrive`,
      headers: { cookie: 'dev-ops-times=utc', 'sec-fetch-site': 'same-origin' },
      auth: { strategy: 'session', credentials }
    })
    const cookie = cookieOf(posted.headers['set-cookie'])

    await get(`${path}/result`, cookie)

    const page = await get(path, cookie)

    expect(bannerOf(page.$)).toMatchObject({
      title: 'Redriven.',
      text: 'Checking for the result…'
    })
  })

  test.each([
    [
      'GAS has not got it',
      Object.assign(new Error('Response Error: 404'), {
        output: { statusCode: 404 },
        data: { isResponseError: true, payload: {}, res: {} }
      })
    ],
    [
      'GAS doesn’t answer',
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    ]
  ])(
    '%s: a 502 with nothing in it, which the page ignores',
    async (_case, error) => {
      vi.mocked(findEvent).mockRejectedValue(error)

      const answer = await get(`${path}/result`)

      expect(answer.statusCode).toBe(statusCodes.badGateway)
      expect(answer.payload).toBe('')
    }
  )
})
