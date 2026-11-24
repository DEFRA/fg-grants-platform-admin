import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../common/config.ts'
import { statusCodes } from '../common/status-codes.ts'
import { wreck } from '../common/wreck.ts'
import { plugins } from '../main.ts'
import { createServer } from '../server/index.ts'
import {
  injectCounted,
  sidebarHrefs,
  toShell,
  type FakeGas,
  type GasAnswer
} from './test-utils.ts'
import { toRouteKey } from './upstream.ts'
import { needsAttention } from './use-cases/overview-fixtures.ts'
import {
  storedApplication,
  storedCase,
  storedTokenDocument,
  toStoredBase64,
  woodlandDefinition
} from './use-cases/test-fixtures.ts'

vi.mock(import('../common/config.ts'))

const operator = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const applicationsAdmin = { ...operator, scope: ['FCP.GrantApplicationsAdmin'] }

const marker = 'from-the-answer'
const shell = toShell(marker)
const markerHref = `/dev-ops/marked/${marker}`

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
  headers?: Record<string, string>
  gas?: FakeGas
  calls: string[]
  status: number
  drawn: Drawn
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
  bucket: 'gas.events',
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
  bucket: 'gas.events',
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
  document: storedTokenDocument()
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
      headers: {
        ...(row.method === 'POST' ? sameOrigin() : {}),
        ...row.headers
      },
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
}

const lists: Row[] = [
  {
    name: 'a list',
    url: '/dev-ops/events/gas',
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a later page of a list',
    url: '/dev-ops/events/gas?cursor=c2&page=2',
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'every page of a list through one, read by GAS in turn',
    url: '/dev-ops/events/gas?through=3',
    gas: { [listCall]: withShell(listAnswer({ pageRows: [0, 0, 0] })) },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a list GAS read without the search it refused',
    url: '/dev-ops/events/gas',
    gas: {
      [listCall]: withShell(listAnswer({ refusedSearch: { refusal: null } }))
    },
    calls: [listCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an address GAS refuses',
    url: '/dev-ops/events/gas?nope=1',
    gas: {
      [listCall]: refusal(statusCodes.badRequest, {
        code: 'ADDRESS_REFUSED',
        problems: {
          unknownKeys: ['nope'],
          repeatedKeys: [],
          unknownValues: []
        },
        bucket: 'gas.events'
      })
    },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a time range GPA can’t read, the address checked only',
    url: '/dev-ops/events/gas?from=yesterday',
    gas: { [listCall]: withShell({ bucket: 'gas.events', list: null }) },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'Clear all',
    url: '/dev-ops/events/gas?clear=all',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'an old link with the retired audit switch',
    url: '/dev-ops/events/gas?audit=on',
    calls: [],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a later page of a search no longer held',
    url: '/dev-ops/events/gas?cursor=c2&searched=0b7c1d1e-0000-4000-8000-000000000001',
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
    url: '/dev-ops/events/cw',
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
    url: '/dev-ops/events/gas',
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
    url: '/dev-ops/events/gas',
    gas: { [listCall]: timeout },
    calls: [listCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'a queue’s own address, its 404 drawn with the shell alone',
    url: '/dev-ops/events/gas/outbox?status=DEAD_LETTER',
    gas: { [shellCall]: withShell() },
    calls: [shellCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'an address of a queue no service has, its 404 drawn with the shell alone',
    url: '/dev-ops/events/gas/elsewhere',
    gas: { [shellCall]: withShell() },
    calls: [shellCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'a later page whose cursor GAS can no longer read',
    url: '/dev-ops/events/gas?cursor=c2&page=2',
    gas: {
      [listCall]: refusal(statusCodes.badRequest, { reason: 'INVALID_CURSOR' })
    },
    calls: [listCall],
    status: statusCodes.found,
    drawn: 'redirect'
  },
  {
    name: 'a search, stored and redirected to',
    method: 'POST',
    url: '/dev-ops/events/gas',
    payload: { 'ref-kind': 'ref', 'ref-value': event.eventId },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a search that cannot be one, drawn again over the list',
    method: 'POST',
    url: '/dev-ops/events/gas',
    payload: { 'ref-kind': 'ref', 'ref-value': 'x y' },
    gas: { [listCall]: withShell(listAnswer()) },
    calls: [listCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'an Error search, set in the address and redirected to',
    method: 'POST',
    url: '/dev-ops/events/gas',
    payload: { 'ref-kind': 'error:error', 'ref-value': 'Boom' },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'an Error search too long to be one, drawn again over the list',
    method: 'POST',
    url: '/dev-ops/events/gas',
    payload: { 'ref-kind': 'error:error', 'ref-value': 'x'.repeat(114) },
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

const issueCall = 'POST /grant-admin/clients/{service}/{clientId}/tokens'
const tokenCall =
  'DELETE /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}'
const rotateCall =
  'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/rotate'
const expiryCall =
  'PUT /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/expiry'
const revokeCall =
  'POST /grant-admin/clients/{service}/{clientId}/tokens/{tokenId}/revoke'

/** A token write GAS refused, naming its code (null on a 5xx) and carrying the list, or null for one it couldn't read. */
const tokenRefusal = (
  status: number,
  code: string | null,
  list: object[] | null = [listed],
  more: object = {}
): GasAnswer =>
  refusal(status, { code, message: 'Refused', tokens: list, ...more })

/** A token issued or rotated, with the service's list after it. */
const tokenIssued = (
  list: object[] | null = [listed],
  answered: object | null = shell
): GasAnswer => ({
  status: 201,
  body: { service: 'gas', token: listed, tokens: list, shell: answered }
})

const newToken = { clientId: 'fg-gas-backend', expiry: 'never', date: '' }
const revokeTyped = { confirmText: 'fg-gas-backend', hint: 'a1B2' }

/** Each refusal a write can meet, drawn from its own answer in one call, whether or not it carries the list. */
const tokenRefusals: [string, string, object, string, number, string][] = [
  [
    'issue',
    '/dev-ops/clients/gas/tokens',
    newToken,
    issueCall,
    400,
    'API_CLIENT_INVALID_NAME'
  ],
  [
    'issue',
    '/dev-ops/clients/gas/tokens',
    newToken,
    issueCall,
    400,
    'API_TOKEN_INVALID_EXPIRY'
  ],
  [
    'issue',
    '/dev-ops/clients/gas/tokens',
    newToken,
    issueCall,
    409,
    'API_TOKEN_DUPLICATE'
  ],
  [
    'rotate',
    `${tokenUrl}/rotate`,
    { keepOld: 'none' },
    rotateCall,
    409,
    'API_TOKEN_NOT_ACTIVE'
  ],
  [
    'rotate',
    `${tokenUrl}/rotate`,
    { keepOld: 'none' },
    rotateCall,
    409,
    'API_TOKEN_IN_USE'
  ],
  [
    'rotate',
    `${tokenUrl}/rotate`,
    { keepOld: 'none' },
    rotateCall,
    409,
    'API_TOKEN_DUPLICATE'
  ],
  [
    'rotate',
    `${tokenUrl}/rotate`,
    { keepOld: 'none' },
    rotateCall,
    404,
    'API_TOKEN_NOT_FOUND'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: 'custom', date: '2099-01-31' },
    expiryCall,
    400,
    'EXPIRY_PAST'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: 'custom', date: '2099-01-31' },
    expiryCall,
    409,
    'EXPIRY_UNCHANGED'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: 'never' },
    expiryCall,
    409,
    'EXPIRY_UNCHANGED'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: '30' },
    expiryCall,
    400,
    'API_TOKEN_INVALID_EXPIRY'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: '30' },
    expiryCall,
    409,
    'API_TOKEN_IN_USE'
  ],
  [
    'expiry',
    `${tokenUrl}/expiry`,
    { expiry: '30' },
    expiryCall,
    409,
    'API_TOKEN_NOT_ACTIVE'
  ],
  [
    'revoke',
    `${tokenUrl}/revoke`,
    revokeTyped,
    revokeCall,
    409,
    'API_TOKEN_NOT_ACTIVE'
  ],
  [
    'revoke',
    `${tokenUrl}/revoke`,
    revokeTyped,
    revokeCall,
    409,
    'API_TOKEN_IN_USE'
  ],
  [
    'revoke',
    `${tokenUrl}/revoke`,
    revokeTyped,
    revokeCall,
    404,
    'API_TOKEN_NOT_FOUND'
  ],
  ['delete', `${tokenUrl}/delete`, {}, tokenCall, 409, 'API_TOKEN_ACTIVE'],
  ['delete', `${tokenUrl}/delete`, {}, tokenCall, 404, 'API_TOKEN_NOT_FOUND']
]

const tokenRefusalRows: Row[] = tokenRefusals.flatMap(
  ([action, url, payload, call, status, errorCode]) =>
    [
      ['with the list', [listed]],
      ['with no list GAS could read', null]
    ].map(([how, list]) => ({
      name: `${action} refused ${errorCode} (${JSON.stringify(payload)}), ${how}`,
      method: 'POST' as const,
      url,
      payload,
      gas: { [call]: tokenRefusal(status, errorCode, list as object[] | null) },
      calls: [call],
      status: statusCodes.badRequest,
      drawn: 'shell' as const
    }))
)

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
    name: 'the access tokens, when GAS does not answer',
    url: '/dev-ops/clients/cw',
    gas: { [tokensCall]: timeout },
    calls: [tokensCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'a token issued, revealed from its answer',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: newToken,
    gas: {
      [issueCall]: tokenIssued()
    },
    calls: [issueCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a token issued whose list GAS could not read',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: newToken,
    gas: {
      [issueCall]: tokenIssued(null)
    },
    calls: [issueCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a token issued with no shell GAS could build',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: newToken,
    gas: { [issueCall]: tokenIssued([listed], null) },
    calls: [issueCall],
    status: statusCodes.ok,
    drawn: 'no-lists'
  },
  {
    name: 'a token GAS failed with a 5xx and no code, carrying the list',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: newToken,
    gas: { [issueCall]: tokenRefusal(500, null) },
    calls: [issueCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a revoke GAS failed with a 5xx and no code, with no list',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: revokeTyped,
    gas: { [revokeCall]: tokenRefusal(500, null, null) },
    calls: [revokeCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a revoke refused with no shell GAS could build',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: revokeTyped,
    gas: {
      [revokeCall]: {
        status: 409,
        body: {
          code: 'API_TOKEN_IN_USE',
          message: 'Refused',
          tokens: [listed],
          shell: null
        }
      }
    },
    calls: [revokeCall],
    status: statusCodes.badRequest,
    drawn: 'no-lists'
  },
  ...[
    ['with the list', [listed]],
    ['with no list GAS could read', null]
  ].map(
    ([how, list]): Row => ({
      name: `a token for a client with active tokens, not confirmed, ${how}`,
      method: 'POST',
      url: '/dev-ops/clients/gas/tokens',
      payload: newToken,
      gas: {
        [issueCall]: tokenRefusal(409, 'HAS_ACTIVE', list as object[] | null, {
          active: 1
        })
      },
      calls: [issueCall],
      status: statusCodes.ok,
      drawn: 'shell'
    })
  ),
  {
    name: 'a token for CW, when GAS could not reach CW',
    method: 'POST',
    url: '/dev-ops/clients/cw/tokens',
    payload: newToken,
    gas: { [issueCall]: tokenRefusal(503, 'CW_UNREACHABLE', null) },
    calls: [issueCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a token GAS did not answer for in time',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: newToken,
    gas: { [issueCall]: timeout },
    calls: [issueCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a token form with no client',
    method: 'POST',
    url: '/dev-ops/clients/gas/tokens',
    payload: { ...newToken, clientId: '' },
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a token rotated, revealed from its answer',
    method: 'POST',
    url: `${tokenUrl}/rotate`,
    payload: { keepOld: 'none' },
    gas: {
      [rotateCall]: tokenIssued()
    },
    calls: [rotateCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'an expiry changed to a preset',
    method: 'POST',
    url: `${tokenUrl}/expiry`,
    payload: { expiry: '30' },
    gas: { [expiryCall]: { body: { service: 'gas', token: listed } } },
    calls: [expiryCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'an expiry changed to a custom date',
    method: 'POST',
    url: `${tokenUrl}/expiry`,
    payload: { expiry: 'custom', date: '2099-01-31' },
    gas: { [expiryCall]: { body: { service: 'gas', token: listed } } },
    calls: [expiryCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a custom expiry with no date',
    method: 'POST',
    url: `${tokenUrl}/expiry`,
    payload: { expiry: 'custom', date: '' },
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a token revoked',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: revokeTyped,
    gas: { [revokeCall]: { status: 204 } },
    calls: [revokeCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a revoke not confirmed',
    method: 'POST',
    url: `${tokenUrl}/revoke`,
    payload: { ...revokeTyped, confirmText: 'something else' },
    gas: { [tokensCall]: withShell(tokens) },
    calls: [tokensCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a token deleted',
    method: 'POST',
    url: `${tokenUrl}/delete`,
    payload: {},
    gas: { [tokenCall]: { status: 204 } },
    calls: [tokenCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  ...tokenRefusalRows
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

const names = {
  phases: [{ code: 'PHASE_PRE_AWARD', name: 'Pre award' }],
  stage: 'Review application',
  status: 'Application received'
}

const recordNames: [string, object | null][] = [
  ['with the names of where it is', names],
  ['with no names', null],
  [
    'with its phases named but not its stage or status',
    { ...names, stage: null, status: null }
  ]
]

const tabs = [
  ['Overview', ''],
  ['Events', '?tab=events'],
  ['Raw', '?tab=raw']
]

const caseUrl = '/dev-ops/cases/woodland/f02-7d8-a61'

const applicationHeader = (header: object) => ({
  clientRef: 'a7c-2f1-9e4',
  code: 'woodland',
  position,
  counterpart: null,
  fetchedAt: at,
  ...header
})

const caseHeader = (header: object) => ({
  caseRef: 'f02-7d8-a61',
  workflowCode: 'woodland',
  position,
  closed: false,
  closedAt: null,
  counterpart: null,
  fetchedAt: at,
  ...header
})

/** Every tab of a record, with or without names, then each way GAS can fail to answer for it; Raw with the record's stored document. */
const recordRows = (
  noun: string,
  url: string,
  call: string,
  header: (names: object) => object,
  reason: string,
  document: string
): Row[] => [
  ...tabs.flatMap(([tab, query]) =>
    recordNames.map(
      ([named, given]): Row => ({
        name: `${noun}’s ${tab}, ${named}`,
        url: `${url}${query}`,
        gas: {
          [call]: withShell({
            ...recordPage(header({ names: given })),
            ...(tab === 'Raw' && { document })
          })
        },
        calls: [call],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    )
  ),
  {
    name: `${noun} GAS has not got`,
    url,
    gas: { [call]: refusal(statusCodes.notFound, { reason }) },
    calls: [call],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: `${noun} GAS could not read`,
    url,
    gas: { [call]: refusal(statusCodes.serviceUnavailable) },
    calls: [call],
    status: statusCodes.serviceUnavailable,
    drawn: 'shell'
  },
  {
    name: `${noun}, when GAS does not answer`,
    url,
    gas: { [call]: timeout },
    calls: [call],
    status: statusCodes.gatewayTimeout,
    drawn: 'no-lists'
  }
]

const records: Row[] = [
  ...recordRows(
    'an application',
    applicationUrl,
    applicationCall,
    applicationHeader,
    'APPLICATION_NOT_FOUND',
    toStoredBase64(storedApplication)
  ),
  ...recordRows(
    'a case',
    caseUrl,
    caseCall,
    caseHeader,
    'CASE_NOT_FOUND',
    toStoredBase64(storedCase)
  )
]

const eventsRead = {
  outcome: 'read',
  events: { rows: [], more: false },
  sourceErrors: []
}

/** GAS judges a grant version's retention itself; a workflow's comes without it. */
const grantOverview = (versionEvents: object | null) =>
  withShell({
    ...recordPage(grantHeader),
    ...(versionEvents && {
      versionEvents:
        versionEvents === eventsRead
          ? { ...eventsRead, pastDeletion: false }
          : versionEvents
    })
  })

const workflowOverview = (versionEvents: object | null) =>
  withShell({
    ...recordPage(workflowHeader),
    ...(versionEvents && { versionEvents })
  })

const phasesCall = 'GET /grant-admin/workflows/{code}/versions/{version}/phases'

const phases = (grantStatusMap: object | null) =>
  withShell({
    ...recordPage(workflowHeader),
    definition: grantStatusMap && woodlandDefinition,
    grantStatusMap
  })

const lifecycle = {
  phases: [],
  initialPosition: null,
  amendablePositions: [],
  waysIn: [],
  externalMappings: [],
  claimApproval: null
}

const versionPages: Row[] = [
  ...[
    ['read', eventsRead],
    ['timed out', { outcome: 'timed-out' }],
    ['failed', { outcome: 'failed' }]
  ].flatMap(([name, versionEvents]): Row[] => [
    {
      name: `a grant version’s Overview, its events ${name}`,
      url: '/dev-ops/grants/woodland/1.2.0',
      gas: { [grantCall]: grantOverview(versionEvents as object) },
      calls: [grantCall],
      status: statusCodes.ok,
      drawn: 'shell'
    },
    {
      name: `a workflow version’s Overview, its events ${name}`,
      url: '/dev-ops/workflows/woodland/1.2.0',
      gas: { [workflowCall]: workflowOverview(versionEvents as object) },
      calls: [workflowCall],
      status: statusCodes.ok,
      drawn: 'shell'
    }
  ]),
  {
    name: 'a workflow version’s Overview, answered with no shell',
    url: '/dev-ops/workflows/woodland/1.2.0',
    gas: {
      [workflowCall]: {
        body: {
          ...recordPage(workflowHeader),
          versionEvents: eventsRead,
          shell: null
        }
      }
    },
    calls: [workflowCall],
    status: statusCodes.ok,
    drawn: 'no-lists'
  },
  {
    name: 'a grant version’s other tab',
    url: '/dev-ops/grants/woodland/1.2.0?tab=raw',
    gas: {
      [grantCall]: withShell({ ...recordPage(grantHeader), definition: null })
    },
    calls: [grantCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a grant version’s retired Events tab',
    url: '/dev-ops/grants/woodland/1.2.0?tab=events',
    calls: [],
    status: statusCodes.found,
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
  },
  {
    name: 'a grant version, when GAS does not answer',
    url: '/dev-ops/grants/woodland/1.2.0',
    gas: { [grantCall]: timeout },
    calls: [grantCall],
    status: statusCodes.gatewayTimeout,
    drawn: 'no-lists'
  },
  ...[
    ['found', { outcome: 'found', lifecycle }],
    ['no-grant', { outcome: 'no-grant' }],
    ['not-stored', { outcome: 'not-stored' }],
    ['unreadable', { outcome: 'unreadable' }],
    ['unavailable', { outcome: 'unavailable' }],
    ['null, the workflow not stored', null]
  ].map(
    ([name, grantStatusMap]): Row => ({
      name: `a workflow version’s Phases, its grant status map ${name}`,
      url: '/dev-ops/workflows/woodland/1.2.0?tab=phases',
      gas: { [phasesCall]: phases(grantStatusMap as object | null) },
      calls: [phasesCall],
      status: statusCodes.ok,
      drawn: 'shell'
    })
  ),
  {
    name: 'a workflow version’s Phases GAS has not got',
    url: '/dev-ops/workflows/woodland/9.9.9?tab=phases',
    gas: {
      [phasesCall]: refusal(statusCodes.notFound, {
        reason: 'WORKFLOW_VERSION_NOT_FOUND'
      })
    },
    calls: [phasesCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'a workflow version’s other tab',
    url: '/dev-ops/workflows/woodland/1.2.0?tab=tasks',
    gas: {
      [workflowCall]: withShell({
        ...recordPage(workflowHeader),
        definition: woodlandDefinition
      })
    },
    calls: [workflowCall],
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
  }
]

const overviewCall = 'GET /grant-admin/overview'

const overview: Row[] = [
  {
    name: 'the Overview',
    url: '/dev-ops',
    gas: { [overviewCall]: withShell(needsAttention) },
    calls: [overviewCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'the Overview GAS refuses',
    url: '/dev-ops',
    gas: { [overviewCall]: refusal(statusCodes.badRequest) },
    calls: [overviewCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'shell'
  },
  {
    name: 'the Overview GAS fails with a body',
    url: '/dev-ops',
    gas: { [overviewCall]: refusal(statusCodes.internalServerError) },
    calls: [overviewCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'shell'
  },
  {
    name: 'the Overview GAS fails without a body',
    url: '/dev-ops',
    gas: { [overviewCall]: { status: statusCodes.serviceUnavailable } },
    calls: [overviewCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'the Overview, when GAS does not answer',
    url: '/dev-ops',
    gas: { [overviewCall]: timeout },
    calls: [overviewCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
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

const vocabularyCall = 'GET /grant-admin/explore/vocabulary'
const exploreCall = 'POST /grant-admin/explore/query'
const listsCall = 'POST /grant-admin/lists/query'

const vocabulary = { sources: [] }

const explored = {
  source: { name: 'applications', noun: 'application' },
  mode: 'rows',
  read: 'windowed',
  columns: [
    {
      key: 'c0',
      label: 'phases.answers.business',
      kind: 'text',
      aggregate: false,
      path: 'phases.answers.business'
    },
    { key: 'c1', label: 'sbi', kind: 'text', aggregate: false, path: null }
  ],
  rows: [{ open: null, cells: { c0: 'Hilltop Farm', c1: '200000002' } }],
  count: null,
  groups: false,
  unwound: false,
  partial: false,
  unseen: [],
  window: {
    to: '2026-10-01T00:00:00.000Z',
    end: false,
    positions: 'p',
    skipped: []
  }
}

const typedQuery = 'db.applications.find()'
const notHeld = '0b6f3e2a-5c1d-4e8f-9a7b-2c3d4e5f6a7b'
const exploreUrl = '/dev-ops/explore'
const loadMore = { 'x-requested-with': 'gpa-load-more' }
const opening = { 'x-requested-with': 'gpa-doc-line' }
const shownId = 'FgAAAAdfaWQAZ0GgwuSw8aKzxNXmAA=='

const explore: Row[] = [
  {
    name: 'Explore, first opened',
    url: exploreUrl,
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'Explore, when GAS does not answer',
    url: exploreUrl,
    gas: { [vocabularyCall]: timeout },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'no-lists'
  },
  {
    name: 'a run no longer held',
    url: `${exploreUrl}?run=${notHeld}`,
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'every window of a run no longer held',
    url: `${exploreUrl}?run=${notHeld}&through=60`,
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a typed query, checked and held',
    method: 'POST',
    url: exploreUrl,
    payload: { q: typedQuery },
    gas: { [exploreCall]: withShell({ ok: true, source: 'applications' }) },
    calls: [exploreCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a typed query GAS finds invalid, drawn from its check',
    method: 'POST',
    url: exploreUrl,
    payload: { q: 'db.applications.find(' },
    gas: {
      [exploreCall]: refusal(statusCodes.badRequest, {
        reason: 'QUERY_INVALID',
        error: { message: 'Close the list', at: 20, end: 21 },
        vocabulary
      })
    },
    calls: [exploreCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a typed query too long to check',
    method: 'POST',
    url: exploreUrl,
    payload: { q: `db.applications.find({ x: '${'x'.repeat(4000)}' })` },
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'an example picked',
    method: 'POST',
    url: exploreUrl,
    payload: { pick: 'frps-cases-by-status', q: typedQuery },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a pick no longer held',
    method: 'POST',
    url: exploreUrl,
    payload: { pick: 'gone', q: typedQuery },
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'Keep looking without script',
    method: 'POST',
    url: exploreUrl,
    payload: { run: notHeld, page: '2' },
    calls: [],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'Keep looking in place on a run no longer held',
    method: 'POST',
    url: exploreUrl,
    payload: { run: notHeld, page: '2' },
    headers: loadMore,
    calls: [],
    status: statusCodes.conflict,
    drawn: 'no-lists'
  },
  {
    name: 'an open in place of a run no longer held',
    method: 'POST',
    url: exploreUrl,
    payload: { run: notHeld, show: shownId, result: '3' },
    headers: opening,
    calls: [],
    status: statusCodes.gone,
    drawn: 'no-lists'
  },
  {
    name: 'a list opened in Explore',
    method: 'POST',
    url: exploreUrl,
    payload: { from: 'events/gas', list: 'type=CreateCase' },
    gas: { [listsCall]: withShell({ bucket: 'gas.events', list: null }) },
    calls: [listsCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'a list GAS has not got, opened in Explore',
    method: 'POST',
    url: exploreUrl,
    payload: { from: 'events/gas/nowhere', list: '' },
    gas: {
      [listsCall]: refusal(statusCodes.notFound, { code: 'LIST_NOT_FOUND' })
    },
    calls: [listsCall],
    status: statusCodes.notFound,
    drawn: 'shell'
  },
  {
    name: 'a list opened in Explore, when GAS does not answer',
    method: 'POST',
    url: exploreUrl,
    payload: { from: 'events/gas', list: '' },
    gas: { [listsCall]: timeout },
    calls: [listsCall],
    status: statusCodes.serviceUnavailable,
    drawn: 'no-lists'
  },
  {
    name: 'Find others',
    method: 'POST',
    url: exploreUrl,
    payload: {
      find: 'payments-by-sbi',
      record: '/dev-ops/applications/woodland/wmp-aa1-bb2'
    },
    gas: { [exploreCall]: withShell({ ...explored, vocabulary }) },
    calls: [exploreCall],
    status: statusCodes.seeOther,
    drawn: 'redirect'
  },
  {
    name: 'Find others GAS refuses, drawn from its refusal',
    method: 'POST',
    url: exploreUrl,
    payload: {
      find: 'payments-by-sbi',
      record: '/dev-ops/applications/woodland/wmp-aa1-bb2'
    },
    gas: {
      [exploreCall]: refusal(statusCodes.badRequest, {
        reason: 'QUERY_REFUSED',
        vocabulary
      })
    },
    calls: [exploreCall],
    status: statusCodes.badRequest,
    drawn: 'shell'
  },
  {
    name: 'a JSON download of a run no longer held',
    method: 'POST',
    url: `${exploreUrl}.json`,
    payload: { run: notHeld },
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
  },
  {
    name: 'a CSV of a run no longer held',
    method: 'POST',
    url: `${exploreUrl}.csv`,
    payload: { run: notHeld },
    gas: { [vocabularyCall]: withShell(vocabulary) },
    calls: [vocabularyCall],
    status: statusCodes.ok,
    drawn: 'shell'
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

describe('one call per request: versions', () => {
  test.each(versionPages.map((row) => [row.name, row]))(
    '%s',
    async (_name, row) => {
      await expect(check(row)).resolves.toBeUndefined()
    }
  )
})

describe('one call per request: tokens', () => {
  test.each(tokenWrites.map((row) => [row.name, row]))(
    '%s',
    async (_name, row) => {
      await expect(check(row)).resolves.toBeUndefined()
    }
  )

  test('an issue for another client than the one warned about is not confirmed', async () => {
    await inject({
      name: 'issue',
      method: 'POST',
      url: '/dev-ops/clients/gas/tokens',
      payload: { ...newToken, confirmFor: 'grants-ui' },
      gas: {
        [issueCall]: tokenIssued()
      },
      calls: [issueCall],
      status: statusCodes.ok,
      drawn: 'shell'
    })

    const [[, options]] = vi.mocked(wreck.post).mock.calls

    expect(options?.payload).toMatchObject({ confirmed: false })
  })
})

describe('one call per request: the Overview', () => {
  test.each(overview.map((row) => [row.name, row]))(
    '%s',
    async (_name, row) => {
      await expect(check(row)).resolves.toBeUndefined()
    }
  )
})

describe('one call per request: explore', () => {
  test.each(explore.map((row) => [row.name, row]))('%s', async (_name, row) => {
    await expect(check(row)).resolves.toBeUndefined()
  })

  const cookieOf = (setCookie: string | string[] | undefined): string =>
    [setCookie ?? []]
      .flat()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')

  /** A run held by a typed query, and with `read` its first window read, in a session of its own. */
  const holdRun = async (read = false) => {
    const { response } = await inject({
      ...explore[4],
      gas: { [exploreCall]: withShell({ ok: true, source: 'applications' }) }
    })
    const cookie = cookieOf(response.headers['set-cookie'])
    const id = new URL(
      String(response.headers.location),
      'http://x'
    ).searchParams.get('run')!

    if (read) {
      await inject({
        ...explore[0],
        url: `${exploreUrl}?run=${id}`,
        headers: { cookie },
        gas: { [exploreCall]: withShell(explored) }
      })
    }

    return { cookie, id }
  }

  const joined = { ...explored, windowRows: [1, 1], stopped: null, vocabulary }

  const heldRows: [
    string,
    boolean,
    (id: string) => Omit<Row, 'name' | 'headers'>
  ][] = [
    [
      'a run’s first window',
      false,
      (id) => ({
        url: `${exploreUrl}?run=${id}`,
        gas: { [exploreCall]: withShell({ ...explored, vocabulary }) },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    ],
    [
      'a run’s first window, when GAS does not answer',
      false,
      (id) => ({
        url: `${exploreUrl}?run=${id}`,
        gas: { [exploreCall]: timeout },
        calls: [exploreCall],
        status: statusCodes.serviceUnavailable,
        drawn: 'no-lists'
      })
    ],
    [
      'every window of a run through the one named, read in one call',
      true,
      (id) => ({
        url: `${exploreUrl}?run=${id}&through=2`,
        gas: { [exploreCall]: withShell(joined) },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    ],
    [
      'every window of a run, a later one stopped',
      true,
      (id) => ({
        url: `${exploreUrl}?run=${id}&through=2`,
        gas: {
          [exploreCall]: withShell({
            ...joined,
            windowRows: [1],
            stopped: { statusCode: 504, code: 'TIMED_OUT' }
          })
        },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    ],
    [
      'every window of a run through one not yet reached',
      false,
      (id) => ({
        url: `${exploreUrl}?run=${id}&through=5`,
        calls: [],
        status: statusCodes.seeOther,
        drawn: 'redirect'
      })
    ],
    [
      'Keep looking in place',
      true,
      (id) => ({
        method: 'POST',
        url: exploreUrl,
        payload: { run: id, page: '2' },
        extra: loadMore,
        gas: { [exploreCall]: withShell({ ...explored, vocabulary }) },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    ],
    [
      'a run’s first window, while another query of this person’s runs',
      false,
      (id) => ({
        url: `${exploreUrl}?run=${id}`,
        gas: {
          [exploreCall]: refusal(statusCodes.tooManyRequests, {
            reason: 'QUERY_BUSY'
          })
        },
        calls: [exploreCall],
        status: statusCodes.tooManyRequests,
        drawn: 'shell'
      })
    ],
    [
      'every window of a run, while another query of this person’s runs',
      true,
      (id) => ({
        url: `${exploreUrl}?run=${id}&through=2`,
        gas: {
          [exploreCall]: refusal(statusCodes.tooManyRequests, {
            reason: 'QUERY_BUSY'
          })
        },
        calls: [exploreCall],
        status: statusCodes.tooManyRequests,
        drawn: 'shell'
      })
    ],
    [
      'Keep looking in place, while another query of this person’s runs',
      true,
      (id) => ({
        method: 'POST',
        url: exploreUrl,
        payload: { run: id, page: '2' },
        extra: loadMore,
        gas: {
          [exploreCall]: refusal(statusCodes.tooManyRequests, {
            reason: 'QUERY_BUSY'
          })
        },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'shell'
      })
    ],
    [
      'a CSV of a run',
      true,
      (id) => ({
        method: 'POST',
        url: `${exploreUrl}.csv`,
        payload: { run: id },
        gas: { [exploreCall]: withShell(explored) },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'no-lists'
      })
    ],
    [
      'a JSON download of a run, read as GAS streams it',
      true,
      (id) => ({
        method: 'POST',
        url: `${exploreUrl}.json`,
        payload: { run: id },
        gas: {
          [exploreCall]: {
            body: [
              { header: { source: explored.source, download: { rows: 5000 } } },
              { end: { stopped: null, searchedTo: null, skipped: [] } }
            ]
              .map((line) => `${JSON.stringify(line)}\n`)
              .join('')
          }
        },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'no-lists'
      })
    ],
    [
      'a JSON download GAS refuses, drawn from its refusal',
      true,
      (id) => ({
        method: 'POST',
        url: `${exploreUrl}.json`,
        payload: { run: id },
        gas: {
          [exploreCall]: refusal(statusCodes.serviceUnavailable, {
            vocabulary
          })
        },
        calls: [exploreCall],
        status: statusCodes.serviceUnavailable,
        drawn: 'shell'
      })
    ],
    [
      'Show it, which holds a run by the row’s _id and reads nothing',
      false,
      (id) => ({
        method: 'POST',
        url: exploreUrl,
        payload: { run: id, show: shownId, result: '3' },
        calls: [],
        status: statusCodes.seeOther,
        drawn: 'redirect'
      })
    ],
    [
      'an open in place, which reads the row now and holds nothing',
      false,
      (id) => ({
        method: 'POST',
        url: exploreUrl,
        payload: { run: id, show: shownId, result: '3' },
        extra: opening,
        gas: {
          [exploreCall]: withShell({
            ...explored,
            read: 'exact',
            window: null,
            count: { n: 1, capped: false },
            rows: [
              {
                ...explored.rows[0],
                id: shownId,
                at: [],
                doc: shownId,
                start: { doc: shownId, cut: false },
                context: null,
                docNote: null
              }
            ],
            documents: { whole: true, bytes: 44, gone: false },
            vocabulary
          })
        },
        calls: [exploreCall],
        status: statusCodes.ok,
        drawn: 'no-lists'
      })
    ],
    [
      'an open in place, while another query of this person’s runs',
      false,
      (id) => ({
        method: 'POST',
        url: exploreUrl,
        payload: { run: id, show: shownId, result: '3' },
        extra: opening,
        gas: {
          [exploreCall]: refusal(statusCodes.tooManyRequests, {
            reason: 'QUERY_BUSY'
          })
        },
        calls: [exploreCall],
        status: statusCodes.tooManyRequests,
        drawn: 'no-lists'
      })
    ],
    [
      'a CSV GAS refuses, drawn from its refusal',
      true,
      (id) => ({
        method: 'POST',
        url: `${exploreUrl}.csv`,
        payload: { run: id },
        gas: {
          [exploreCall]: refusal(statusCodes.serviceUnavailable, {
            vocabulary
          })
        },
        calls: [exploreCall],
        status: statusCodes.serviceUnavailable,
        drawn: 'shell'
      })
    ]
  ]

  test.each(heldRows)('%s', async (name, read, toRow) => {
    const { cookie, id } = await holdRun(read)
    const { extra, ...row } = toRow(id) as Omit<Row, 'name'> & {
      extra?: Record<string, string>
    }

    await expect(
      check({ ...row, name, headers: { cookie, ...extra } })
    ).resolves.toBeUndefined()
  })
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
  const rows = [
    ...lists,
    ...events,
    ...records,
    ...versionPages,
    ...tokenWrites,
    ...overview,
    ...shellPages,
    ...explore
  ]

  test('has a row for each Dev Ops route', () => {
    const covered = new Set(rows.map(routeKeyOf))
    const routes = server
      .table()
      .filter(({ path }) => path.startsWith('/dev-ops'))
      .map((route) => toRouteKey({ route } as never))

    expect(routes.filter((route) => !covered.has(route))).toEqual([])
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
      ['/dev-ops/marked/first'],
      ['/dev-ops/marked/second']
    ])
    expect([first.calls, second.calls]).toEqual([
      toCalls([eventCall]),
      toCalls([eventCall])
    ])
  })
})
