import Boom from '@hapi/boom'

import { logger } from '../../common/logger.ts'
import type {
  ListedToken,
  TokenKey
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiry,
  deleteToken,
  issueToken,
  listTokens,
  revokeToken,
  rotateToken
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from './access-tokens.use-case.ts'
import { generateToken } from './generate-token.ts'

vi.mock(import('../repositories/clients.repository.ts'))
vi.mock(import('../../common/logger.ts'))
vi.mock(import('./generate-token.ts'))

const raw = 'raw-token-value-that-must-stay-in-memory-x7Qa'
const hash = 'f'.repeat(64)

const token: ListedToken = {
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: 'x7Qa',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: { _id: { $oid: '6650c1f2a9e4b1d07c20bd91' }, id: 'a1b••••••f2c' }
}

const key: TokenKey = {
  service: 'gas',
  clientId: 'grants-ui',
  tokenId: token.tokenId
}

/** As @hapi/wreck rejects for a non-2xx answer. */
const responseError = (statusCode: number, body: object = {}) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

/** As @hapi/wreck rejects when no connection could be made. */
const connectionError = (code: string) =>
  Boom.badGateway(
    'Client request error',
    Object.assign(new Error(`connect ${code}`), { code })
  )

const timeout = () => Boom.gatewayTimeout('Client request timeout')

const loggedText = () =>
  JSON.stringify([
    vi.mocked(logger.warn).mock.calls,
    vi.mocked(logger.error).mock.calls
  ])

const failures = [
  [
    'a refusal, with its error code',
    responseError(409, { errorCode: 'API_TOKEN_IN_USE' }),
    { outcome: 'refused', statusCode: 409, errorCode: 'API_TOKEN_IN_USE' }
  ],
  [
    'a refusal with no error code',
    responseError(403),
    { outcome: 'refused', statusCode: 403, errorCode: null }
  ],
  [
    'a 404',
    responseError(404, { errorCode: 'API_TOKEN_NOT_FOUND' }),
    { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' }
  ],
  [
    'a connection that was never made',
    connectionError('ECONNREFUSED'),
    { outcome: 'unreachable' }
  ],
  [
    'a host that does not resolve',
    connectionError('ENOTFOUND'),
    { outcome: 'unreachable' }
  ],
  [
    'GAS answering 503 CW_UNREACHABLE: it could not reach Caseworking at all',
    responseError(503, { errorCode: 'CW_UNREACHABLE' }),
    { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' }
  ],
  [
    'a 503 without that code, which may have been sent on',
    responseError(503),
    { outcome: 'unknown' }
  ],
  ['a timeout', timeout(), { outcome: 'unknown' }],
  ['a 500', responseError(500), { outcome: 'unknown' }],
  ['a 502 from GAS', responseError(502), { outcome: 'unknown' }],
  ['a 504 from GAS', responseError(504), { outcome: 'unknown' }],
  ['a read that timed out', Boom.clientTimeout(), { outcome: 'unknown' }],
  [
    'a connection dropped mid-request',
    connectionError('ECONNRESET'),
    { outcome: 'unknown' }
  ],
  ['anything else', new Error('boom'), { outcome: 'unknown' }]
] as const

describe('listAccessTokensUseCase', () => {
  test('answers the tokens GAS lists', async () => {
    vi.mocked(listTokens).mockResolvedValue([token])

    await expect(listAccessTokensUseCase('cw')).resolves.toEqual([token])
    expect(listTokens).toHaveBeenCalledWith('cw')
  })

  test.each(failures)('answers null for %s', async (_name, error) => {
    vi.mocked(listTokens).mockRejectedValue(error)

    await expect(listAccessTokensUseCase('gas')).resolves.toBeNull()
  })
})

describe('issueAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(listTokens).mockResolvedValue([token])
    vi.mocked(issueToken).mockResolvedValue(token)
  })

  test('sends GAS the hash and hint only, and keeps the raw token for the reveal', async () => {
    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', '2027-02-02T13:50:00.000Z')
    ).resolves.toEqual({ outcome: 'issued', raw, token })

    expect(issueToken).toHaveBeenCalledWith(
      'gas',
      'grants-ui',
      { tokenHash: hash, tokenHint: 'x7Qa' },
      { expiresAt: '2027-02-02T13:50:00.000Z', newClient: false }
    )
    expect(JSON.stringify(vi.mocked(issueToken).mock.calls)).not.toContain(raw)
  })

  test('creates the client when no row has its name', async () => {
    await issueAccessTokenUseCase('cw', 'new-service', null)

    expect(issueToken).toHaveBeenCalledWith(
      'cw',
      'new-service',
      expect.anything(),
      { expiresAt: null, newClient: true }
    )
  })

  test('issues nothing when the list cannot be read', async () => {
    vi.mocked(listTokens).mockRejectedValue(timeout())

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', null)
    ).resolves.toEqual({ outcome: 'unchecked' })
    expect(issueToken).not.toHaveBeenCalled()
  })

  test.each(failures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(issueToken).mockRejectedValue(error)

      const result = await issueAccessTokenUseCase('gas', 'grants-ui', null)

      expect(result).toEqual(expected)
      expect(JSON.stringify(result)).not.toContain(raw)
    }
  )

  test('logs no raw token, hash or hint', async () => {
    vi.mocked(issueToken).mockRejectedValue(responseError(500))

    await issueAccessTokenUseCase('gas', 'grants-ui', null)

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(loggedText()).not.toContain(raw)
    expect(loggedText()).not.toContain(hash)
    expect(loggedText()).not.toContain('x7Qa')
  })
})

describe('rotateAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(rotateToken).mockResolvedValue(token)
  })

  test('sends the new hash and hint with the overlap, keeping the raw token for the reveal', async () => {
    await expect(rotateAccessTokenUseCase(key, '24h')).resolves.toEqual({
      outcome: 'issued',
      raw,
      token
    })
    expect(rotateToken).toHaveBeenCalledWith(
      key,
      { tokenHash: hash, tokenHint: 'x7Qa' },
      '24h'
    )
  })

  test.each(failures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(rotateToken).mockRejectedValue(error)

      const result = await rotateAccessTokenUseCase(key, 'none')

      expect(result).toEqual(expected)
      expect(loggedText()).not.toContain(raw)
      expect(loggedText()).not.toContain(hash)
      expect(loggedText()).not.toContain('x7Qa')
    }
  )
})

describe('changeTokenExpiryUseCase', () => {
  test('answers the changed token', async () => {
    vi.mocked(changeTokenExpiry).mockResolvedValue(token)

    await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual({
      outcome: 'done',
      token
    })
    expect(changeTokenExpiry).toHaveBeenCalledWith(key, null)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(changeTokenExpiry).mockRejectedValue(error)

    await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual(expected)
  })
})

describe('revokeAccessTokenUseCase', () => {
  test('revokes the token at this address', async () => {
    vi.mocked(revokeToken).mockResolvedValue(undefined)

    await expect(revokeAccessTokenUseCase(key)).resolves.toEqual({
      outcome: 'done'
    })
    expect(revokeToken).toHaveBeenCalledWith(key)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(revokeToken).mockRejectedValue(error)

    await expect(revokeAccessTokenUseCase(key)).resolves.toEqual(expected)
  })

  test('warns, rather than errs, on a refusal, naming the token by its address', async () => {
    vi.mocked(revokeToken).mockRejectedValue(
      responseError(409, { errorCode: 'API_TOKEN_IN_USE' })
    )

    await revokeAccessTokenUseCase(key)

    expect(logger.warn).toHaveBeenCalledWith(
      `Did not revoke token gas/grants-ui/${token.tokenId}: 409 API_TOKEN_IN_USE`
    )
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('deleteAccessTokenUseCase', () => {
  test('deletes the token at this address', async () => {
    vi.mocked(deleteToken).mockResolvedValue(undefined)

    await expect(deleteAccessTokenUseCase(key)).resolves.toEqual({
      outcome: 'done'
    })
    expect(deleteToken).toHaveBeenCalledWith(key)
  })

  test.each(failures)('reports %s', async (_name, error, expected) => {
    vi.mocked(deleteToken).mockRejectedValue(error)

    await expect(deleteAccessTokenUseCase(key)).resolves.toEqual(expected)
  })
})
