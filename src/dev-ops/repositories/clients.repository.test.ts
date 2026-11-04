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
  rotateToken
} from './clients.repository.ts'

vi.mock(import('../../common/gas.ts'))

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
    vi.mocked(postToGas).mockResolvedValue({ service: 'gas', token })
    vi.mocked(putToGas).mockResolvedValue({ service: 'gas', token })
  })

  test('lists the tokens of one service', async () => {
    await expect(listTokens('gas')).resolves.toEqual([token])
    expect(getFromGas).toHaveBeenCalledWith('/grant-admin/clients/gas')
  })

  test('issues a token for a new client with its hash, hint and expiry', async () => {
    await expect(
      issueToken('gas', 'grants-ui', hash, {
        expiresAt: '2027-02-02T13:50:00.000Z',
        newClient: true
      })
    ).resolves.toEqual(token)
    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/clients/gas/grants-ui/tokens',
      {
        payload: {
          tokenHash: hash.tokenHash,
          tokenHint: 'x7Qa',
          expiresAt: '2027-02-02T13:50:00.000Z',
          newClient: true
        }
      }
    )
  })

  test('sends GAS nothing but the hash, the hint, the expiry and newClient', async () => {
    await issueToken('gas', 'grants-ui', hash, {
      expiresAt: null,
      newClient: true
    })
    await rotateToken(key, hash, '24h')

    const [issued, rotated] = vi
      .mocked(postToGas)
      .mock.calls.map(([, options]) =>
        Object.keys(options?.payload ?? {}).sort()
      )

    expect(issued).toEqual(['expiresAt', 'newClient', 'tokenHash', 'tokenHint'])
    expect(rotated).toEqual(['keepOld', 'tokenHash', 'tokenHint'])
  })

  test('leaves newClient out for a client that already exists', async () => {
    await issueToken('gas', 'grants-ui', hash, {
      expiresAt: null,
      newClient: false
    })

    expect(vi.mocked(postToGas).mock.calls[0][1]).toEqual({
      payload: { tokenHash: hash.tokenHash, tokenHint: 'x7Qa', expiresAt: null }
    })
  })

  test('escapes the client and token in the path', async () => {
    await revokeToken({ ...key, clientId: 'a/b', tokenId: '../x' })

    expect(postToGas).toHaveBeenCalledWith(
      '/grant-admin/clients/cw/a%2Fb/tokens/..%2Fx/revoke'
    )
  })

  test('rotates a token, saying how long the old one keeps working', async () => {
    await expect(rotateToken(key, hash, '7d')).resolves.toEqual(token)
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
