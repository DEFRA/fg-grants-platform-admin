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

vi.mock(import('../repositories/clients.repository.ts'), async (original) => ({
  ...(await original()),
  changeTokenExpiry: vi.fn(),
  deleteToken: vi.fn(),
  issueToken: vi.fn(),
  listTokens: vi.fn(),
  revokeToken: vi.fn(),
  rotateToken: vi.fn()
}))
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
  expiringSoon: false,
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

/** Hapi's answer for a path it has no route for. */
const noRoute = { statusCode: 404, error: 'Not Found', message: 'Not Found' }

/** GAS's Boom for a token or client it hasn't got, with the code it adds. */
const notFoundBody = (errorCode: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: 'CW-BE has no such client or token',
  errorCode
})

/** A 5xx with no code, as Hapi sends GAS's Boom: only a 500 has its message hidden. */
const gasError = (statusCode: number, error: string, message: string) => ({
  statusCode,
  error,
  message
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
    'a 404 for a token GAS hasn’t got',
    responseError(404, notFoundBody('API_TOKEN_NOT_FOUND')),
    { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' }
  ],
  [
    'a 404 for a client GAS hasn’t got',
    responseError(404, notFoundBody('API_CLIENT_NOT_FOUND')),
    { outcome: 'refused', statusCode: 404, errorCode: 'API_CLIENT_NOT_FOUND' }
  ],
  [
    'a 404 with no error code: a GAS with no token routes',
    responseError(404, noRoute),
    { outcome: 'not-offered' }
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
    'a 503 without that code, as from a proxy in front of GAS, which may have been sent on',
    responseError(
      503,
      gasError(503, 'Service Unavailable', 'Service Unavailable')
    ),
    { outcome: 'errored' }
  ],
  ['a timeout here', timeout(), { outcome: 'unknown', gasSilent: true }],
  [
    'a 500',
    responseError(
      500,
      gasError(
        500,
        'Internal Server Error',
        'An internal server error occurred'
      )
    ),
    { outcome: 'errored' }
  ],
  [
    'a 502 from GAS, as when CW has no client routes',
    responseError(
      502,
      gasError(502, 'Bad Gateway', 'CW-BE has no client routes')
    ),
    { outcome: 'errored' }
  ],
  [
    'a 504 from GAS: CW didn’t answer it in time',
    responseError(
      504,
      gasError(
        504,
        'Gateway Time-out',
        'CW-BE did not answer in time for clients'
      )
    ),
    { outcome: 'unknown' }
  ],
  [
    'a read that timed out',
    Boom.clientTimeout(),
    { outcome: 'unknown', gasSilent: true }
  ],
  [
    'a connection dropped mid-request',
    connectionError('ECONNRESET'),
    { outcome: 'unknown', gasSilent: true }
  ],
  ['anything else', new Error('boom'), { outcome: 'errored' }]
] as const

/** A write's failure, with the list its page is drawn from: a refusal with no list is one GAS couldn't read, any other failure says why itself. */
const asWriteFailure = (failure: (typeof failures)[number][2]) => ({
  ...failure,
  list: failure.outcome === 'refused' ? { outcome: 'unlisted' } : failure
})

/**
 * As GAS answers a token write: its reason in `code`, null on a 5xx, and
 * `tokens` on every failure, where a list read names it in `errorCode`.
 * Hapi's own 404 is left as it is.
 */
interface GasAnswer {
  data: { isResponseError: true; payload: Record<string, unknown> }
  output: { statusCode: number }
}

const isGasAnswer = (error: unknown): error is GasAnswer =>
  (error as Partial<GasAnswer>).data?.isResponseError === true &&
  (error as GasAnswer).data.payload !== noRoute

const asWriteError = (error: unknown) => {
  if (!isGasAnswer(error)) {
    return error
  }

  const { errorCode = null, ...rest } = error.data.payload

  return responseError(error.output.statusCode, {
    ...rest,
    code: errorCode,
    tokens: null
  })
}

const writeFailures = failures.map(
  ([name, error, expected]) =>
    [name, asWriteError(error), asWriteFailure(expected)] as const
)

const listedBody = { tokens: [token] }

/** Every write's answer to a refusal carrying the list, carrying none, or GAS not reaching CW for it. */
const refusalLists = [
  [
    'a refusal carrying the list',
    responseError(409, { code: 'API_TOKEN_IN_USE', ...listedBody }),
    {
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_IN_USE',
      list: { outcome: 'done', tokens: [token] }
    }
  ],
  [
    'a refusal whose list GAS couldn’t read',
    responseError(409, { code: 'API_TOKEN_IN_USE', tokens: null }),
    {
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_IN_USE',
      list: { outcome: 'unlisted' }
    }
  ],
  [
    'CW not reached, with no list',
    responseError(503, { code: 'CW_UNREACHABLE', tokens: null }),
    {
      outcome: 'unreachable',
      errorCode: 'CW_UNREACHABLE',
      list: { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' }
    }
  ]
] as const

describe('listAccessTokensUseCase', () => {
  test('answers the tokens GAS lists', async () => {
    vi.mocked(listTokens).mockResolvedValue([token])

    await expect(listAccessTokensUseCase('cw')).resolves.toEqual({
      outcome: 'done',
      tokens: [token]
    })
    expect(listTokens).toHaveBeenCalledWith('cw')
  })

  test.each(failures)(
    'answers %s as the failure, so the page can say who didn’t answer',
    async (_name, error, expected) => {
      vi.mocked(listTokens).mockRejectedValue(error)

      await expect(listAccessTokensUseCase('gas')).resolves.toEqual(expected)
    }
  )

  test('answers CW not reached when GAS says so', async () => {
    vi.mocked(listTokens).mockRejectedValue(
      responseError(502, { errorCode: 'CW_UNREACHABLE' })
    )

    await expect(listAccessTokensUseCase('cw')).resolves.toEqual({
      outcome: 'unreachable',
      errorCode: 'CW_UNREACHABLE'
    })
  })
})

describe('issueAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(issueToken).mockResolvedValue({ token, tokens: [token] })
  })

  test('sends GAS the hash and hint only, and keeps the raw token for the reveal, beside the list GAS answered', async () => {
    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: '2027-02-02T13:50:00.000Z',
        confirmed: true
      })
    ).resolves.toEqual({
      outcome: 'issued',
      raw,
      token,
      list: { outcome: 'done', tokens: [token] }
    })

    expect(issueToken).toHaveBeenCalledWith(
      'gas',
      'grants-ui',
      { tokenHash: hash, tokenHint: 'x7Qa' },
      { expiresAt: '2027-02-02T13:50:00.000Z', confirmed: true }
    )
    expect(listTokens).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(issueToken).mock.calls)).not.toContain(raw)
  })

  test('reveals the token when GAS couldn’t read the list after it', async () => {
    vi.mocked(issueToken).mockResolvedValue({ token, tokens: null })

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })
    ).resolves.toEqual({
      outcome: 'issued',
      raw,
      token,
      list: { outcome: 'unlisted' }
    })
  })

  test.each([
    ['the list', listedBody, { outcome: 'done', tokens: [token] }],
    ['no list GAS could read', { tokens: null }, { outcome: 'unlisted' }]
  ])(
    'answers HAS_ACTIVE with the count of active tokens and %s, warning nothing',
    async (_name, body, list) => {
      vi.mocked(issueToken).mockRejectedValue(
        responseError(409, { code: 'HAS_ACTIVE', active: 2, ...body })
      )

      await expect(
        issueAccessTokenUseCase('gas', 'grants-ui', {
          expiresAt: null,
          confirmed: false
        })
      ).resolves.toEqual({ outcome: 'has-active', active: 2, list })
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  test('answers a HAS_ACTIVE with no count as any refusal', async () => {
    vi.mocked(issueToken).mockRejectedValue(
      responseError(409, { code: 'HAS_ACTIVE', ...listedBody })
    )

    await expect(
      issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: false
      })
    ).resolves.toEqual({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'HAS_ACTIVE',
      list: { outcome: 'done', tokens: [token] }
    })
  })

  test.each(refusalLists)('answers %s', async (_name, error, expected) => {
    vi.mocked(issueToken).mockRejectedValue(error)

    await expect(
      issueAccessTokenUseCase('cw', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })
    ).resolves.toEqual(expected)
  })

  test.each(writeFailures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(issueToken).mockRejectedValue(error)

      const result = await issueAccessTokenUseCase('gas', 'grants-ui', {
        expiresAt: null,
        confirmed: true
      })

      expect(result).toEqual(expected)
      expect(JSON.stringify(result)).not.toContain(raw)
    }
  )

  test('logs no raw token, hash or hint', async () => {
    vi.mocked(issueToken).mockRejectedValue(responseError(500))

    await issueAccessTokenUseCase('gas', 'grants-ui', {
      expiresAt: null,
      confirmed: true
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(loggedText()).not.toContain(raw)
    expect(loggedText()).not.toContain(hash)
    expect(loggedText()).not.toContain('x7Qa')
  })
})

describe('rotateAccessTokenUseCase', () => {
  beforeEach(() => {
    vi.mocked(generateToken).mockReturnValue({ raw, hash, hint: 'x7Qa' })
    vi.mocked(rotateToken).mockResolvedValue({ token, tokens: [token] })
  })

  test('sends the new hash and hint with the overlap, keeping the raw token for the reveal', async () => {
    await expect(rotateAccessTokenUseCase(key, '24h')).resolves.toEqual({
      outcome: 'issued',
      raw,
      token,
      list: { outcome: 'done', tokens: [token] }
    })
    expect(rotateToken).toHaveBeenCalledWith(
      key,
      { tokenHash: hash, tokenHint: 'x7Qa' },
      '24h'
    )
  })

  test.each(writeFailures)(
    'reports %s and drops the raw token',
    async (_name, error, expected) => {
      vi.mocked(rotateToken).mockRejectedValue(error)

      const result = await rotateAccessTokenUseCase(key, 'none')

      expect(result).toEqual(expected)
      expect(JSON.stringify(result)).not.toContain(raw)
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

  test.each([...writeFailures, ...refusalLists])(
    'reports %s',
    async (_name, error, expected) => {
      vi.mocked(changeTokenExpiry).mockRejectedValue(error)

      await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual(
        expected
      )
    }
  )

  test.each([
    ['EXPIRY_PAST', 400],
    ['EXPIRY_UNCHANGED', 409]
  ])('reports %s with the list', async (errorCode, statusCode) => {
    vi.mocked(changeTokenExpiry).mockRejectedValue(
      responseError(statusCode, { code: errorCode, ...listedBody })
    )

    await expect(changeTokenExpiryUseCase(key, null)).resolves.toEqual({
      outcome: 'refused',
      statusCode,
      errorCode,
      list: { outcome: 'done', tokens: [token] }
    })
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

  test.each([...writeFailures, ...refusalLists])(
    'reports %s',
    async (_name, error, expected) => {
      vi.mocked(revokeToken).mockRejectedValue(error)

      await expect(revokeAccessTokenUseCase(key)).resolves.toEqual(expected)
    }
  )

  test('a 5xx with no code, even carrying the list, is a write that may have happened', async () => {
    vi.mocked(revokeToken).mockRejectedValue(
      responseError(500, {
        code: null,
        message: 'An internal server error occurred',
        ...listedBody
      })
    )

    await expect(revokeAccessTokenUseCase(key)).resolves.toEqual({
      outcome: 'errored',
      list: { outcome: 'done', tokens: [token] }
    })
  })

  test('a write’s reason is read from code alone', async () => {
    vi.mocked(revokeToken).mockRejectedValue(
      responseError(409, { errorCode: 'API_TOKEN_IN_USE', code: null })
    )

    await expect(revokeAccessTokenUseCase(key)).resolves.toMatchObject({
      outcome: 'refused',
      errorCode: null
    })
  })

  test('warns, rather than errs, on a refusal, naming the token by its address', async () => {
    vi.mocked(revokeToken).mockRejectedValue(
      responseError(409, { code: 'API_TOKEN_IN_USE' })
    )

    await revokeAccessTokenUseCase(key)

    expect(logger.warn).toHaveBeenCalledWith(
      `Did not revoke token gas/grants-ui/${token.tokenId}: 409 API_TOKEN_IN_USE`
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('warns, rather than errs, when GAS has no token routes', async () => {
    vi.mocked(revokeToken).mockRejectedValue(responseError(404, noRoute))

    await revokeAccessTokenUseCase(key)

    expect(logger.warn).toHaveBeenCalledWith(
      `Did not revoke token gas/grants-ui/${token.tokenId}: fg-gas-backend has no access token routes`
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

  test.each([...writeFailures, ...refusalLists])(
    'reports %s',
    async (_name, error, expected) => {
      vi.mocked(deleteToken).mockRejectedValue(error)

      await expect(deleteAccessTokenUseCase(key)).resolves.toEqual(expected)
    }
  )
})
