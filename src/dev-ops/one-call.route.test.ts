import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../common/config.ts'
import { statusCodes } from '../common/status-codes.ts'
import { plugins } from '../main.ts'
import { createServer } from '../server/index.ts'
import { pendingOneCall } from './one-call.pending.ts'
import {
  injectCounted,
  sidebarHrefs,
  toShell,
  type FakeGas,
  type GasAnswer
} from './test-utils.ts'
import { toRouteKey } from './upstream.ts'
import { woodlandDefinition } from './use-cases/test-fixtures.ts'

vi.mock(import('../common/config.ts'))

const operator = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const applicationsAdmin = { ...operator, scope: ['FCP.GrantApplicationsAdmin'] }

const marker = 'from-the-answer'
const shell = toShell(marker)
const markerHref = `/dev-ops/events/gas/${marker}`

const withShell = (body: object = {}): GasAnswer => ({
  body: { ...body, shell }
})

const refusal = (status: number, body: object = {}): GasAnswer => ({
  status,
  body: { ...body, shell }
})

const timeout: GasAnswer = { fail: 'timeout' }

/** What a row's page is drawn with: lists from the answer's shell, no lists, or no page at all. */
type Drawn = 'shell' | 'no-lists' | 'redirect'

interface Row {
  name: string
  method?: 'GET' | 'POST'
  url: string
  payload?: object
  credentials?: object | null
  gas?: FakeGas
  calls: string[]
  status: number
  drawn: Drawn
  /** A route that still makes more than one call in some state, as `one-call.pending.ts` lists it. */
  pending?: true
}

const eventId = '665f1c2e9a1b2c3d4e5f6a7b'
const eventUrl = `/dev-ops/events/gas/outbox/${eventId}`
const tokenId = '6710c4a2e1b3f40012ab34cd'
const tokenUrl = `/dev-ops/clients/gas/fg-gas-backend/tokens/${tokenId}`

const shellCall = 'GET /grant-admin/shell'
const listCall = 'POST /grant-admin/lists/query'
const eventCall = 'GET /grant-admin/events/{service}/{box}/{id}'
const tokensCall = 'GET /grant-admin/clients/{service}'

const event = {
  service: 'gas',
  box: 'outbox',
  id: eventId,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  eventType: 'CaseStatusUpdated',
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
  lastRedrive: null,
  purgeDeletionDate: '2026-07-16T10:00:00.000Z',
  revision: 3
}

const listPage = {
  bucket: 'gas.outbox',
  plan: {
    kind: 'index',
    index: [],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: []
}

const listAnswer = (list: object = {}) => ({
  bucket: 'gas.outbox',
  list: {
    ...listPage,
    pageRows: [0],
    stopped: null,
    refusedSearch: null,
    ...list
  }
})

const listed = {
  tokenId,
  clientId: 'fg-gas-backend',
  tokenHint: 'a1B2',
  status: 'ACTIVE',
  createdAt: '2026-10-01T09:00:00.000Z',
  createdBy: 'Ada Lovelace',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: {}
}

const tokens = { tokens: [listed] }

const sameOrigin = () => ({
  origin: new URL(config.get('auth.appBaseUrl')).origin,
  'sec-fetch-site': 'same-origin'
})

/** A request carrying it fails before its handler runs, as a 500 that has asked GAS nothing. */
const failHeader = 'x-test-fail'

let server: Server

beforeAll(async () => {
  server = await createServer()
  server.ext('onPreHandler', (request, h) => {
    if (request.headers[failHeader]) {
      throw new Error('Failed before the handler')
    }

    return h.continue
  })
  await server.register(plugins)
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

const authOf = ({ credentials = operator }: Row) =>
  credentials === null
    ? {}
    : { auth: { strategy: 'session', credentials: credentials as object } }

const inject = (row: Row) =>
  injectCounted(
    server,
    {
      method: row.method ?? 'GET',
      url: row.url,
      payload: row.payload,
      headers: row.method === 'POST' ? sameOrigin() : {},
      ...authOf(row)
    },
    row.gas ?? {}
  )

const routeKeyOf = (row: Row): string => {
  const route = server.match(row.method ?? 'GET', row.url.split('?')[0])

  return route ? toRouteKey({ route } as never) : ''
}

const toCalls = (keys: string[]) =>
  keys.map((key) => {
    const [method, path] = key.split(' ')

    return { method, path }
  })

const drawnOf = (payload: string, status: number): Drawn => {
  if (status >= 300 && status < 400) {
    return 'redirect'
  }

  return sidebarHrefs(load(payload)).includes(markerHref) ? 'shell' : 'no-lists'
}

const check = async (row: Row) => {
  const { response, calls } = await inject(row)

  expect(calls).toEqual(toCalls(row.calls))
  expect(response.statusCode).toBe(row.status)
  expect(drawnOf(response.payload, response.statusCode)).toBe(row.drawn)
  expect(pendingOneCall.includes(routeKeyOf(row))).toBe(row.pending === true)
  expect(row.calls.length <= 1 || row.pending === true).toBe(true)
}

const lists: Row[] = [
  {
    name: 'the root opens the first list',
    url: '/dev-ops',
    gas: { [shellCall]: withShell() },
    calls: [shellCall],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'the root, when GAS does not answer',
    url: '/dev-ops',
    gas: { [shellCall]: timeout },
    calls: [shellCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'a list',
    url: '/dev-ops/events/gas/outbox',
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a later page of a list',
    url: '/dev-ops/events/gas/outbox?cursor=c2&page=2',
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'every page of a list through one, read by GAS in turn',
    url: '/dev-ops/events/gas/outbox?through=3',
    gas: { [listCall]: withShell(listAnswer({ pageRows: [0, 0, 0] })) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a list GAS read without the search it refused',
    url: '/dev-ops/events/gas/outbox',
    gas: {
      [listCall]: withShell(listAnswer({ refusedSearch: { refusal: null } }))
    },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an address GAS refuses',
    url: '/dev-ops/events/gas/outbox?nope=1',
    gas: {
      [listCall]: refusal(statusCodes.badRequest, {
        code: 'ADDRESS_REFUSED',
        problems: {
          unknownKeys: ['nope'],
          repeatedKeys: [],
          unknownValues: []
        },
        bucket: 'gas.outbox'
      })
    },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a time range GPA can’t read, the address checked only',
    url: '/dev-ops/events/gas/outbox?from=yesterday',
    gas: { [listCall]: withShell({ bucket: 'gas.outbox', list: null }) },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'Clear all',
    url: '/dev-ops/events/gas/outbox?clear=all',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'an old link with the retired audit switch',
    url: '/dev-ops/events/gas/outbox?audit=on',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a later page of a search no longer held',
    url: '/dev-ops/events/gas/outbox?cursor=c2&searched=0b7c1d1e-0000-4000-8000-000000000001',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a path no list is at',
    url: '/dev-ops/nothing/here',
    gas: {
      [listCall]: refusal(statusCodes.notFound, { code: 'LIST_NOT_FOUND' })
    },
    calls: [listCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'a CW list while GAS can’t reach CW',
    url: '/dev-ops/events/cw/outbox',
    gas: {
      [listCall]: refusal(statusCodes.serviceUnavailable, {
        code: 'CW_UNREACHABLE'
      })
    },
    calls: [listCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'shell'
  },
  {
    name: 'a list while GAS can’t build its catalogue',
    url: '/dev-ops/events/gas/outbox',
    gas: {
      [listCall]: {
        status: statusCodes.serviceUnavailable,
        body: { code: 'CATALOGUE_UNAVAILABLE', shell: null }
      }
    },
    calls: [listCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'a list, when GAS does not answer',
    url: '/dev-ops/events/gas/outbox',
    gas: { [listCall]: timeout },
    calls: [listCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'a search, stored and redirected to',
    method: 'POST',
    url: '/dev-ops/events/gas/outbox',
    payload: { 'ref-kind': 'ref', 'ref-value': event.eventId },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a search that cannot be one, drawn again over the list',
    method: 'POST',
    url: '/dev-ops/events/gas/outbox',
    payload: { 'ref-kind': 'ref', 'ref-value': 'x y' },
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  }
]

const purgeCall = 'POST /grant-admin/events/{service}/{box}/{id}/purge'
const payloadCall = 'POST /grant-admin/events/{service}/{box}/{id}/payload'
const redriveCall = 'POST /grant-admin/events/{service}/{box}/{id}/redrive'

const saveForm = { text: '{"id":"3f2c1a0e"}', revision: 3, note: 'Fixed' }

const events: Row[] = [
  {
    name: 'an event',
    url: eventUrl,
    gas: { [eventCall]: withShell(event) },
    calls: [eventCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an event, its editor open',
    url: `${eventUrl}?edit=payload`,
    gas: { [eventCall]: withShell(event) },
    calls: [eventCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an event, its purge dialog open',
    url: `${eventUrl}?confirm=purge`,
    gas: { [eventCall]: withShell(event) },
    calls: [eventCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an event GAS has not got',
    url: eventUrl,
    gas: { [eventCall]: refusal(statusCodes.notFound) },
    calls: [eventCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'an event, when GAS does not answer',
    url: eventUrl,
    gas: { [eventCall]: timeout },
    calls: [eventCall],
    status: statusCodes.gatewayTimeout,
    drawn: 'no-lists'
  },
  {
    name: 'a redrive',
    method: 'POST',
    url: `${eventUrl}/redrive`,
    gas: { [redriveCall]: {} },
    calls: [redriveCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a redrive GAS refuses',
    method: 'POST',
    url: `${eventUrl}/redrive`,
    gas: {
      [redriveCall]: refusal(statusCodes.conflict, { status: 'PUBLISHED' })
    },
    calls: [redriveCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a purge, sent without reading the event first',
    method: 'POST',
    url: `${eventUrl}/purge`,
    payload: { reasonCode: 'SENT_IN_ERROR', note: '' },
    gas: { [purgeCall]: {} },
    calls: [purgeCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a purge GAS says isn’t purgeable',
    method: 'POST',
    url: `${eventUrl}/purge`,
    payload: { reasonCode: 'SENT_IN_ERROR', note: '' },
    gas: {
      [purgeCall]: refusal(statusCodes.conflict, {
        code: 'NOT_PURGEABLE',
        status: null,
        statusLabel: null
      })
    },
    calls: [purgeCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a purge form with nothing chosen',
    method: 'POST',
    url: `${eventUrl}/purge`,
    payload: {},
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a payload review',
    method: 'POST',
    url: `${eventUrl}/payload/review`,
    payload: { text: '{"id":"3f2c1a0e"}', revision: 3 },
    gas: { [eventCall]: withShell(event) },
    calls: [eventCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a payload saved',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: saveForm,
    gas: { [payloadCall]: { body: { payloadRevision: 4, redrive: null } } },
    calls: [payloadCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a payload saved and redriven, in one call',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: { ...saveForm, then: 'redrive' },
    gas: {
      [payloadCall]: {
        body: { payloadRevision: 4, redrive: { outcome: 'redriven' } }
      }
    },
    calls: [payloadCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a payload saved whose redrive failed',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: { ...saveForm, then: 'redrive' },
    gas: {
      [payloadCall]: {
        body: { payloadRevision: 4, redrive: { outcome: 'failed' } }
      }
    },
    calls: [payloadCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a payload save with no note',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: { ...saveForm, note: '' },
    gas: { [eventCall]: withShell(event) },
    calls: [eventCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a payload save made stale, drawn over the event GAS answered with',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: saveForm,
    gas: {
      [payloadCall]: refusal(statusCodes.preconditionFailed, {
        code: 'STALE_REVISION',
        event: { ...event, payloadRevision: 4 }
      })
    },
    calls: [payloadCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a payload save made stale, the event not read again',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: saveForm,
    gas: {
      [payloadCall]: refusal(statusCodes.preconditionFailed, {
        code: 'STALE_REVISION',
        event: null
      })
    },
    calls: [payloadCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'shell'
  },
  {
    name: 'a payload save GAS did not answer, held',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: saveForm,
    gas: { [payloadCall]: timeout },
    calls: [payloadCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a payload save GAS failed, held',
    method: 'POST',
    url: `${eventUrl}/payload`,
    payload: saveForm,
    gas: { [payloadCall]: refusal(statusCodes.internalServerError) },
    calls: [payloadCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  }
]

const tokenWrites: Row[] = [
  {
    name: 'the access tokens',
    url: '/dev-ops/clients/gas',
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a token issued',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: { clientId: 'fg-gas-backend', expiry: 'never' },
    gas: {
      [tokensCall]: withShell(tokens),
      'POST /grant-admin/clients/{service}/{clientId}/tokens': {
        status: 201,
        body: { token: listed }
      }
    },
    calls: [
      tokensCall,
      'POST /grant-admin/clients/{service}/{clientId}/tokens',
      tokensCall
    ],
    status: statusCodes.ok,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a token form with no client',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: { clientId: '', expiry: 'never' },
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a token rotated',
    method: 'POST',
    url: `${tokenUrl}/rotate`,
    payload: { keepOld: 'none' },
    gas: {
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/rotate':
        { status: 201, body: { token: listed } },
      [tokensCall]: withShell(tokens)
    },
    calls: [
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/rotate',
      tokensCall
    ],
    status: statusCodes.ok,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'an expiry changed',
    method: 'POST',
    url: `${tokenUrl}/expiry`,
    payload: { expiry: 'never' },
    gas: {
      'PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry': {
        body: { token: listed }
      }
    },
    calls: [
      'PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry'
    ],
    status: statusCodes.seeOther,
    drawn: 'redirect',
    pending: true
  },
  {
    name: 'an expiry GAS refuses',
    method: 'POST',
    url: `${tokenUrl}/expiry`,
    payload: { expiry: 'never' },
    gas: {
      'PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry':
        refusal(statusCodes.badRequest, {
          errorCode: 'API_TOKEN_INVALID_EXPIRY'
        }),
      [tokensCall]: withShell(tokens)
    },
    calls: [
      'PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry',
      tokensCall
    ],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a token revoked',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: { confirm: 'fg-gas-backend' },
    gas: {
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke':
        { status: 204 }
    },
    calls: [
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke'
    ],
    status: statusCodes.seeOther,
    drawn: 'redirect',
    pending: true
  },
  {
    name: 'a revoke not confirmed',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: { confirm: 'something else' },
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a token deleted',
    method: 'POST',
    url: `${tokenUrl}/delete`,
    payload: {},
    gas: {
      'DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}': {
        status: 204
      }
    },
    calls: [
      'DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}'
    ],
    status: statusCodes.seeOther,
    drawn: 'redirect',
    pending: true
  },
  {
    name: 'a token GAS refuses to issue',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: { clientId: 'fg-gas-backend', expiry: 'never' },
    gas: {
      [tokensCall]: withShell(tokens),
      'POST /grant-admin/clients/{service}/{clientId}/tokens': refusal(
        statusCodes.conflict,
        { errorCode: 'API_CLIENT_EXISTS' }
      )
    },
    calls: [
      tokensCall,
      'POST /grant-admin/clients/{service}/{clientId}/tokens',
      tokensCall
    ],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a revoke GAS refuses',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: { confirm: 'fg-gas-backend' },
    gas: {
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke':
        refusal(statusCodes.conflict, { errorCode: 'API_TOKEN_NOT_ACTIVE' }),
      [tokensCall]: withShell(tokens)
    },
    calls: [
      'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke',
      tokensCall
    ],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a delete GAS refuses',
    method: 'POST',
    url: `${tokenUrl}/delete`,
    payload: {},
    gas: {
      'DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}':
        refusal(statusCodes.conflict, { errorCode: 'API_TOKEN_ACTIVE' }),
      [tokensCall]: withShell(tokens)
    },
    calls: [
      'DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}',
      tokensCall
    ],
    status: statusCodes.badRequest,
    drawn: 'shell',
    pending: true
  }
]

const at = '2026-10-10T16:25:00.000Z'

const versions = [{ version: '1.2.0', status: 'active', receivedAt: at }]

const grantHeader = {
  code: 'woodland',
  version: '1.2.0',
  status: 'active',
  receivedAt: at,
  files: { grant: { stored: true, fetchStatus: 'fetched' } },
  versions,
  counterpart: null
}

const workflowHeader = {
  ...grantHeader,
  files: { workflow: { stored: true, fetchStatus: 'fetched' } }
}

const position = { phase: null, stage: null, status: null }

const recordPage = (header: object) => ({
  header,
  overview: null,
  sourceErrors: [],
  sectionErrors: []
})

const applicationUrl = '/dev-ops/applications/woodland/a7c-2f1-9e4'
const applicationCall =
  'GET /grant-admin/grants/{code}/applications/{clientRef}/{tab}'
const caseCall = 'GET /grant-admin/workflows/{code}/cases/{caseRef}/{tab}'
const grantCall = 'GET /grant-admin/grants/{code}/versions/{version}/{read}'
const grantVersionsCall = 'GET /grant-admin/grants/{code}/versions'
const workflowCall =
  'GET /grant-admin/workflows/{code}/versions/{version}/{read}'
const workflowVersionsCall = 'GET /grant-admin/workflows/{code}/versions'

const records: Row[] = [
  {
    name: 'an application',
    url: applicationUrl,
    gas: {
      [applicationCall]: withShell(
        recordPage({
          clientRef: 'a7c-2f1-9e4',
          code: 'woodland',
          position,
          counterpart: null,
          fetchedAt: at
        })
      )
    },
    calls: [applicationCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an application GAS has not got',
    url: applicationUrl,
    gas: {
      [applicationCall]: refusal(statusCodes.notFound, {
        reason: 'APPLICATION_NOT_FOUND'
      })
    },
    calls: [applicationCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'an application, when GAS does not answer',
    url: applicationUrl,
    gas: { [applicationCall]: timeout },
    calls: [applicationCall],
    status: statusCodes.gatewayTimeout,
    drawn: 'no-lists'
  },
  {
    name: 'a case',
    url: '/dev-ops/cases/woodland/f02-7d8-a61',
    gas: {
      [caseCall]: withShell(
        recordPage({
          caseRef: 'f02-7d8-a61',
          workflowCode: 'woodland',
          position,
          closed: false,
          closedAt: null,
          counterpart: null,
          fetchedAt: at
        })
      )
    },
    calls: [caseCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a grant version',
    url: '/dev-ops/grants/woodland/1.2.0',
    gas: { [grantCall]: withShell(recordPage(grantHeader)) },
    calls: [grantCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a grant, opening its current version',
    url: '/dev-ops/grants/woodland',
    gas: {
      [grantVersionsCall]: withShell({
        code: 'woodland',
        current: '1.2.0',
        versions
      })
    },
    calls: [grantVersionsCall],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a grant with no current version',
    url: '/dev-ops/grants/woodland',
    gas: {
      [grantVersionsCall]: withShell({
        code: 'woodland',
        current: null,
        versions
      })
    },
    calls: [grantVersionsCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'a grant version’s files fetched',
    method: 'POST',
    url: '/dev-ops/grants/woodland/1.2.0/fetch',
    gas: {
      'POST /grant-admin/grants/{code}/versions/{version}/fetch': {
        body: { files: [] }
      }
    },
    calls: ['POST /grant-admin/grants/{code}/versions/{version}/fetch'],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a workflow version',
    url: '/dev-ops/workflows/woodland/1.2.0',
    gas: { [workflowCall]: withShell(recordPage(workflowHeader)) },
    calls: [workflowCall],
    status: statusCodes.ok,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a workflow version’s Phases, read with its grant’s',
    url: '/dev-ops/workflows/woodland/1.2.0?tab=phases',
    gas: {
      [workflowCall]: withShell({
        ...recordPage(workflowHeader),
        definition: woodlandDefinition
      }),
      [grantCall]: withShell(recordPage(grantHeader))
    },
    calls: [workflowCall, grantCall],
    status: statusCodes.ok,
    drawn: 'shell',
    pending: true
  },
  {
    name: 'a workflow, opening its current version',
    url: '/dev-ops/workflows/woodland',
    gas: {
      [workflowVersionsCall]: withShell({
        code: 'woodland',
        current: '1.2.0',
        versions
      })
    },
    calls: [workflowVersionsCall],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a workflow version’s file fetched',
    method: 'POST',
    url: '/dev-ops/workflows/woodland/1.2.0/fetch',
    gas: {
      'POST /grant-admin/workflows/{code}/versions/{version}/fetch': {
        body: { files: [] }
      }
    },
    calls: ['POST /grant-admin/workflows/{code}/versions/{version}/fetch'],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a grant version GAS has not got',
    url: '/dev-ops/grants/woodland/9.9.9',
    gas: {
      [grantCall]: refusal(statusCodes.notFound, {
        reason: 'GRANT_VERSION_NOT_FOUND'
      })
    },
    calls: [grantCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  }
]

const shellPages: Row[] = [
  {
    name: 'the Times address',
    url: '/dev-ops/times?back=%2Fdev-ops%2Fclients%2Fgas',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a Times choice saved',
    method: 'POST',
    url: '/dev-ops/times?back=%2Fdev-ops%2Fclients%2Fgas',
    payload: { times: 'uk' },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'the signed out page',
    url: '/dev-ops/signed-out',
    credentials: null,
    calls: [],
    status: statusCodes.ok,
    drawn: 'no-lists'
  },
  {
    name: 'a page refused to someone without the role',
    url: '/dev-ops/clients/gas',
    credentials: applicationsAdmin,
    calls: [],
    status: statusCodes.forbidden,
    drawn: 'no-lists'
  }
]

describe('one call per request: lists', () => {
  test.each(lists.map((row) => [row.name, row]))('%s', async (_name, row) => {
    await expect(check(row)).resolves.toBeUndefined()
  })
})

describe('one call per request: events', () => {
  test.each(events.map((row) => [row.name, row]))('%s', async (_name, row) => {
    await expect(check(row)).resolves.toBeUndefined()
  })
})

describe('one call per request: records', () => {
  test.each(records.map((row) => [row.name, row]))('%s', async (_name, row) => {
    await expect(check(row)).resolves.toBeUndefined()
  })
})

describe('one call per request: tokens', () => {
  test.each(tokenWrites.map((row) => [row.name, row]))(
    '%s',
    async (_name, row) => {
      await expect(check(row)).resolves.toBeUndefined()
    }
  )
})

describe('one call per request: the shell', () => {
  test.each(shellPages.map((row) => [row.name, row]))(
    '%s',
    async (_name, row) => {
      await expect(check(row)).resolves.toBeUndefined()
    }
  )
})

describe('one call per request: the shell for a page that asks GAS nothing', () => {
  test('a status page thrown before the handler asks GAS for the shell alone, once', async () => {
    await expect(
      check({
        name: 'refused',
        url: '/dev-ops/clients/nothing',
        gas: { [shellCall]: withShell() },
        calls: [shellCall],
        status: statusCodes.badRequest,
        drawn: 'shell'
      })
    ).resolves.toBeUndefined()
  })

  test('draws no lists when the shell itself cannot be read', async () => {
    await expect(
      check({
        name: 'refused, GAS down',
        url: '/dev-ops/clients/nothing',
        gas: { [shellCall]: { fail: 'refused' } },
        calls: [shellCall],
        status: statusCodes.badRequest,
        drawn: 'no-lists'
      })
    ).resolves.toBeUndefined()
  })

  test('draws no lists and asks nothing more when the page’s own call had no answer', async () => {
    await expect(
      check({
        name: '5xx without a body',
        url: eventUrl,
        gas: { [eventCall]: { status: statusCodes.serviceUnavailable } },
        calls: [eventCall],
        status: statusCodes.serviceUnavailable,
        drawn: 'no-lists'
      })
    ).resolves.toBeUndefined()
  })

  test('asks nothing for a 500', async () => {
    const { response, calls } = await injectCounted(
      server,
      {
        method: 'GET',
        url: '/dev-ops/clients/gas',
        headers: { [failHeader]: '1' },
        auth: { strategy: 'session', credentials: operator }
      },
      { [shellCall]: withShell() }
    )

    expect(response.statusCode).toBe(statusCodes.internalServerError)
    expect(calls).toEqual([])
  })
})

describe('one call per request: every route', () => {
  const rows = [...lists, ...events, ...records, ...tokenWrites, ...shellPages]

  test('has a row for each Dev Ops route', () => {
    const covered = new Set(rows.map(routeKeyOf))
    const routes = server
      .table()
      .filter(({ path }) => path.startsWith('/dev-ops'))
      .map((route) => toRouteKey({ route } as never))

    expect(routes.filter((route) => !covered.has(route))).toEqual([])
  })

  test('lists as pending only routes that still make more than one call', () => {
    const multiple = new Set(
      rows.filter((row) => row.calls.length > 1).map(routeKeyOf)
    )

    expect(pendingOneCall.filter((route) => !multiple.has(route))).toEqual([])
  })

  test('draws each of two pages at once from its own answer’s shell', async () => {
    const page = (own: string) =>
      injectCounted(
        server,
        {
          method: 'GET',
          url: eventUrl,
          auth: { strategy: 'session', credentials: operator }
        },
        { [eventCall]: { body: { ...event, shell: toShell(own) } } }
      )

    const [first, second] = await Promise.all([page('first'), page('second')])
    const hrefs = [first, second].map(({ response }) =>
      sidebarHrefs(load(response.payload)).filter((href) =>
        /\/(first|second)$/.test(href)
      )
    )

    expect(hrefs).toEqual([
      ['/dev-ops/events/gas/first'],
      ['/dev-ops/events/gas/second']
    ])
    expect([first.calls, second.calls]).toEqual([
      toCalls([eventCall]),
      toCalls([eventCall])
    ])
  })
})
