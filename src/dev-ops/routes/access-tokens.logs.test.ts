import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'
import Boom from '@hapi/boom'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { ListedToken } from '../repositories/clients.repository.ts'
import {
  issueToken,
  listTokens,
  rotateToken
} from '../repositories/clients.repository.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../repositories/clients.repository.ts'))
// Every line the app logs, request logs from hapi-pino included, kept to read back.
vi.mock(import('../../common/logger.ts'), async () => {
  const { pino } = await import('pino')
  const lines: string[] = []

  return {
    logger: pino(
      { level: 'trace' },
      { write: (line: string) => lines.push(line) }
    ),
    lines
  } as never
})

const { lines } = (await import('../../common/logger.ts')) as unknown as {
  lines: string[]
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const tokenId = '6650c1f2a9e4b1d07c20bd91'

const token: ListedToken = {
  tokenId,
  clientId: 'grants-ui',
  tokenHint: 'AAAA',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: { _id: { $oid: '6650c1f2a9e4b1d07c20bd91' }, id: 'a1b••••••f2c' }
}

let server: Server

const post = (url: string, payload: Record<string, string>) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'sec-fetch-site': 'same-origin' },
    auth: { strategy: 'session', credentials }
  })

/** The token the response revealed, and the hash and hint GAS was sent for it. */
const secretsOf = (
  payload: string,
  sent: { tokenHash: string; tokenHint: string }
) => [
  load(payload)('[data-testid="token-reveal-token"]').text(),
  sent.tokenHash,
  sent.tokenHint
]

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  lines.length = 0
  vi.mocked(listTokens).mockResolvedValue([token])
})

afterAll(async () => {
  await server.stop()
})

describe('the access token writes, as logged', () => {
  test('log neither the token, its hash nor its hint on New token', async () => {
    vi.mocked(issueToken).mockImplementation(async (_s, _c, sent) => ({
      ...token,
      tokenHint: sent.tokenHint
    }))

    const { payload } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: '90',
      date: ''
    })
    const secrets = secretsOf(payload, vi.mocked(issueToken).mock.calls[0][2])

    expect(lines.length).toBeGreaterThan(0)
    expect(secrets[0]).toHaveLength(43)
    expect(secrets.filter((secret) => lines.join('').includes(secret))).toEqual(
      []
    )
  })

  test('log neither the token, its hash nor its hint on Rotate', async () => {
    vi.mocked(rotateToken).mockImplementation(async (_k, sent) => ({
      ...token,
      tokenHint: sent.tokenHint
    }))

    const { payload } = await post(
      `/dev-ops/clients/gas/grants-ui/tokens/${tokenId}/rotate`,
      { keepOld: '24h' }
    )
    const secrets = secretsOf(payload, vi.mocked(rotateToken).mock.calls[0][1])

    expect(lines.length).toBeGreaterThan(0)
    expect(secrets[0]).toHaveLength(43)
    expect(secrets.filter((secret) => lines.join('').includes(secret))).toEqual(
      []
    )
  })

  test('log neither the hash nor the hint when GAS fails a rotation', async () => {
    vi.mocked(rotateToken).mockRejectedValue(
      new Boom.Boom('Response Error: 500', {
        statusCode: 500,
        data: { isResponseError: true, payload: {} }
      })
    )

    await post(`/dev-ops/clients/gas/grants-ui/tokens/${tokenId}/rotate`, {
      keepOld: '24h'
    })
    const [, sent] = vi.mocked(rotateToken).mock.calls[0]

    expect(lines.join('')).toContain('Could not rotate token')
    expect(lines.join('')).not.toContain(sent.tokenHash)
    expect(lines.join('')).not.toContain(sent.tokenHint)
  })
})
