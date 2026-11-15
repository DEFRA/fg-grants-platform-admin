import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { injectCounted } from '../test-utils.ts'
import type { GasAnswer } from '../test-utils.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const shell = { catalogue: fullCatalogue }

const listCall = 'POST /grant-admin/lists/query'

/** GAS's answer as Hapi sends its Boom, the shell added to it. */
const gasAnswer = (
  status: number,
  error: string,
  message: string
): GasAnswer => ({
  status,
  body: { statusCode: status, error, message, shell }
})

const answeredWithAnError = (service = 'GAS') =>
  `${service} answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.`

let server: Server

const view = async (url: string, answer: GasAnswer) => {
  const { response, calls } = await injectCounted(
    server,
    { method: 'GET', url, auth: { strategy: 'session', credentials } },
    { [listCall]: answer }
  )
  const { statusCode } = response
  const $ = load(response.payload)

  expect(calls).toEqual([{ method: 'POST', path: '/grant-admin/lists/query' }])

  const alert = $('[data-testid="list-alert"]')

  return {
    statusCode,
    title: alert.find('.gpa-alert-title').text().replace(/\s+/g, ' ').trim(),
    body: alert
      .find('.gpa-alert-body > div')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim()
  }
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('a CW list read through GAS, each way it can fail', () => {
  test.each([
    [
      'GAS’s own 500',
      gasAnswer(
        500,
        'Internal Server Error',
        'An internal server error occurred'
      ),
      statusCodes.serviceUnavailable,
      answeredWithAnError()
    ],
    [
      'GAS’s 502 for CW’s error',
      gasAnswer(
        502,
        'Bad Gateway',
        'CW-BE buckets unavailable: Response Error: 500'
      ),
      statusCodes.serviceUnavailable,
      answeredWithAnError('CW')
    ],
    [
      'GAS’s 502 for a CW with no bucket routes',
      gasAnswer(502, 'Bad Gateway', 'CW-BE has no bucket routes'),
      statusCodes.serviceUnavailable,
      answeredWithAnError('CW')
    ],
    [
      'GAS’s 504 for CW not answering',
      gasAnswer(
        504,
        'Gateway Time-out',
        'CW-BE did not answer in time for buckets'
      ),
      statusCodes.gatewayTimeout,
      'CW didn’t answer in time. Nothing has changed — try again in a moment.'
    ]
  ])('cases: %s', async (_name, answer, status, body) => {
    const page = await view('/dev-ops/cases', answer)

    expect(page).toEqual({
      statusCode: status,
      title: 'The cases list couldn’t be loaded.',
      body
    })
  })
})

describe('every kind of list, when GAS answers that the service it called failed', () => {
  test.each([
    ['/dev-ops/events/gas/outbox', 'events', 'GAS'],
    ['/dev-ops/events/cw/outbox', 'events', 'CW'],
    ['/dev-ops/applications', 'applications', 'GAS'],
    ['/dev-ops/cases', 'cases', 'CW'],
    ['/dev-ops/grants', 'grant versions', 'GAS'],
    ['/dev-ops/workflows', 'workflow versions', 'CW']
  ])(
    '%s names the list’s service, and GAS’s logs',
    async (url, noun, service) => {
      const answer = gasAnswer(
        502,
        'Bad Gateway',
        'CW-BE buckets unavailable: Response Error: 500'
      )

      expect(await view(url, answer)).toEqual({
        statusCode: statusCodes.serviceUnavailable,
        title: `The ${noun} list couldn’t be loaded.`,
        body: answeredWithAnError(service)
      })
    }
  )
})

describe('a list GAS never answered for, so no answer carried its lists', () => {
  test.each([
    ['GAS not answering in time', { fail: 'timeout' }],
    ['no connection to GAS', { fail: 'refused' }],
    ['GAS answering with nothing to read', { status: 502 }]
  ] satisfies [string, GasAnswer][])(
    '%s: the lists couldn’t be read, and the sidebar draws none',
    async (_name, answer) => {
      const { response } = await injectCounted(
        server,
        {
          method: 'GET',
          url: '/dev-ops/cases',
          auth: { strategy: 'session', credentials }
        },
        { [listCall]: answer }
      )
      const $ = load(response.payload)

      expect(response.statusCode).toBe(statusCodes.serviceUnavailable)
      expect($('h1').text().trim()).toBe('Dev Ops couldn’t read its lists')
      expect(
        $('[data-testid="shell-nav"] a[href="/dev-ops/cases"]')
      ).toHaveLength(0)
    }
  )
})
