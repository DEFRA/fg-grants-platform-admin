import Boom from '@hapi/boom'

import {
  deleteFromGas,
  getFromGas,
  postToGas,
  putToGas
} from '../../common/gas.ts'
import type { ApiToken, TokenKey } from './clients.repository.ts'
import {
  changeTokenExpiry,
  deleteToken,
  issueToken,
  listTokens,
  revokeToken,
  rotateToken,
  toRefusalBody
} from './clients.repository.ts'
import { storedTokenDocument } from '../use-cases/test-fixtures.ts'

vi.mock(import('../../common/gas.ts'), async (original) => ({
  ...(await original()),
  deleteFromGas: vi.fn(),
  getFromGas: vi.fn(),
  postToGas: vi.fn(),
  putToGas: vi.fn()
}))

const token: ApiToken = {
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: 'x7Qa',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false
}

const key: TokenKey = {
  service: 'cw',
  clientId: 'grants-ui',
  tokenId: token.tokenId
}

const hash = { tokenHash: 'a'.repeat(64), tokenHint: 'x7Qa' }

const tokenPath = `/grant-admin/clients/cw/grants-ui/tokens/${token.tokenId}`

describe('the clients repository', () => {
  beforeEach(() => {
    vi.mocked(getFromGas).mockResolvedValue({ service: 'gas', tokens: [token] })
    vi.mocked(postToGas).mockResolvedValue({
      service: 'gas',
      token,
      tokens: [token]
    })
    vi.mocked(putToGas).mockResolvedValue({ service: 'gas', token })
  })

  test('lists the tokens of one service', async () => {
    await expect(listTokens('gas')).resolves.toEqual([token])
    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/clients/gas')
  })

  test('issues a token with its hash, hint and expiry, answering it and the list after it', async () => {
    await expect(
      issueToken('gas', 'grants-ui', hash, {
        expiresAt: '2027-02-02T13:50:00.000Z',
        confirmed: false
      })
    ).resolves.toEqual({ token, tokens: [token] })
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/clients/gas/grants-ui/tokens',
      {
        payload: {
          tokenHash: hash.tokenHash,
          tokenHint: 'x7Qa',
          expiresAt: '2027-02-02T13:50:00.000Z',
          confirmed: false
        }
      }
    )
  })

  test('answers a null list as GAS sends it', async () => {
    vi.mocked(postToGas).mockResolvedValue({
      service: 'gas',
      token,
      tokens: null
    })

    await expect(rotateToken(key, hash, '24h')).resolves.toEqual({
      token,
      tokens: null
    })
  })

  test('escapes the client and token in the path', async () => {
    await revokeToken({ ...key, clientId: 'a/b', tokenId: '../x' })

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/clients/cw/a%2Fb/tokens/..%2Fx/revoke'
    )
  })

  test('rotates a token, saying how long the old one keeps working', async () => {
    await expect(rotateToken(key, hash, '7d')).resolves.toEqual({
      token,
      tokens: [token]
    })
    expect(postToGas).toHaveBeenCalledWith(`${tokenPath}/rotate`, {
      payload: { tokenHash: hash.tokenHash, tokenHint: 'x7Qa', keepOld: '7d' }
    })
  })

  test('changes when a token expires', async () => {
    await expect(changeTokenExpiry(key, null)).resolves.toEqual(token)
    expect(putToGas).toHaveBeenCalledWith(`${tokenPath}/expiry`, {
      payload: { expiresAt: null }
    })
  })

  test('revokes a token with no body', async () => {
    await revokeToken(key)

    expect(postToGas).toHaveBeenCalledWith(`${tokenPath}/revoke`)
  })

  test('deletes a token', async () => {
    await deleteToken(key)

    expect(deleteFromGas).toHaveBeenCalledWith(tokenPath)
  })
})

/** As @hapi/wreck rejects for GAS's answer, carrying its body. */
const refusal = (statusCode: number, body: unknown) =>
  new Boom.Boom(`Response Error: ${statusCode}`, {
    statusCode,
    data: { isResponseError: true, payload: body }
  })

describe('toRefusalBody', () => {
  const listed = {
    ...token,
    document: storedTokenDocument(),
    expiringSoon: false
  }

  test.each([
    [
      'the list after a refusal',
      refusal(422, { code: 'EXPIRY_PAST', tokens: [listed] }),
      { tokens: [listed], active: null }
    ],
    [
      'a list GAS could not read',
      refusal(422, { code: 'EXPIRY_PAST', tokens: null }),
      { tokens: null, active: null }
    ],
    [
      'the active count of a client that has some',
      refusal(409, { code: 'HAS_ACTIVE', active: 2, tokens: [listed] }),
      { tokens: [listed], active: 2 }
    ],
    [
      'no count on any other code',
      refusal(409, { code: 'NOT_ACTIVE', active: 2 }),
      { tokens: null, active: null }
    ],
    [
      'no list when a token lacks GAS’s expiring-soon verdict',
      refusal(422, { code: 'EXPIRY_PAST', tokens: [token] }),
      { tokens: null, active: null }
    ],
    [
      'no list when a token carries its row in the old shape, not as stored',
      refusal(422, {
        code: 'EXPIRY_PAST',
        tokens: [{ ...token, expiringSoon: false, stored: {} }]
      }),
      { tokens: null, active: null }
    ],
    [
      'no list or count in a malformed body',
      refusal(409, { code: 'HAS_ACTIVE', active: '2', tokens: ['x'] }),
      { tokens: null, active: null }
    ],
    [
      'nothing from a failure with no body',
      new Error('ECONNREFUSED'),
      {
        tokens: null,
        active: null
      }
    ],
    [
      'nothing from a body that is not an object',
      refusal(500, 'oops'),
      {
        tokens: null,
        active: null
      }
    ]
  ])('reads %s', (_case, error, expected) => {
    expect(toRefusalBody(error)).toEqual(expected)
  })
})
