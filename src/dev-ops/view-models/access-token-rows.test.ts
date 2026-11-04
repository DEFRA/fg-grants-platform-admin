import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import {
  toCompareTokens,
  toActions,
  toOpenLabel,
  toTokenRows,
  toTokenState
} from './access-token-rows.ts'

const now = new Date('2026-11-04T13:50:00.000Z')
const day = 86_400_000

const inDays = (days: number): string =>
  new Date(now.getTime() + days * day).toISOString()

const token = (fields: Partial<ListedToken> = {}): ListedToken => ({
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
  stored: {
    _id: { $oid: fields.tokenId ?? '6650c1f2a9e4b1d07c20bd91' },
    id: 'a1b••••••f2c',
    clientId: fields.clientId ?? 'grants-ui'
  },
  ...fields
})

const revoked = token({
  tokenId: '6650c1f2a9e4b1d07c20bd92',
  status: 'REVOKED',
  revokedAt: '2026-11-01T09:00:00.000Z',
  revokedBy: 'Sam Revoker',
  expiresAt: '2026-11-01T09:00:00.000Z'
})

const expired = token({
  tokenId: '6650c1f2a9e4b1d07c20bd93',
  status: 'EXPIRED',
  expiresAt: '2026-11-02T23:59:59.000Z'
})

describe('toTokenState', () => {
  test.each([
    ['active with no expiry', token(), 'active'],
    [
      'active, expiring in 13 days',
      token({ expiresAt: inDays(13) }),
      'expiring'
    ],
    [
      'active, expiring in under a day',
      token({ expiresAt: inDays(0.5) }),
      'expiring'
    ],
    [
      'active, expiring in exactly 14 days',
      token({ expiresAt: inDays(14) }),
      'active'
    ],
    ['active, expiring in 15 days', token({ expiresAt: inDays(15) }), 'active'],
    ['expired', expired, 'expired'],
    ['revoked', revoked, 'revoked']
  ] as const)('reads a token %s as %s', (_name, given, state) => {
    expect(toTokenState(given, now)).toBe(state)
  })

  test.each([
    ['14 days less a millisecond', 14 * day - 1, 'expiring'],
    ['13 days 23 hours', 14 * day - 3_600_000, 'expiring'],
    ['exactly 14 days', 14 * day, 'active'],
    ['14 days and an hour', 14 * day + 3_600_000, 'active'],
    ['a millisecond', 1, 'expiring']
  ] as const)('reads a token with %s left as %s', (_name, ms, state) => {
    expect(
      toTokenState(
        token({ expiresAt: new Date(now.getTime() + ms).toISOString() }),
        now
      )
    ).toBe(state)
  })

  test('takes the service at its word on a token it calls expired', () => {
    expect(
      toTokenState(token({ status: 'EXPIRED', expiresAt: inDays(1) }), now)
    ).toBe('expired')
  })
})

describe('toCompareTokens', () => {
  const order = (tokens: ListedToken[]) =>
    tokens.toSorted(toCompareTokens(now)).map(({ tokenId }) => tokenId)

  test('sorts by client ID, expiring then working then dead, then newest first, with nameless rows last', () => {
    expect(
      order([
        token({ tokenId: 'a1', clientId: 'zeta' }),
        token({ tokenId: 'a2', clientId: null }),
        token({
          tokenId: 'a3',
          status: 'REVOKED',
          createdAt: '2026-11-03T00:00:00.000Z'
        }),
        token({ tokenId: 'a4', createdAt: '2026-10-01T00:00:00.000Z' }),
        token({ tokenId: 'a5', createdAt: '2026-11-01T00:00:00.000Z' }),
        token({ tokenId: 'a6', createdAt: null }),
        token({ tokenId: 'a8', expiresAt: inDays(3), createdAt: null }),
        token({ tokenId: 'a7', clientId: 'alpha' })
      ])
    ).toEqual(['a7', 'a8', 'a5', 'a4', 'a6', 'a3', 'a1', 'a2'])
  })

  test('orders client IDs by character, not by locale', () => {
    expect(
      order([
        token({ tokenId: 'b1', clientId: 'grants-ui' }),
        token({ tokenId: 'b2', clientId: 'grants1' })
      ])
    ).toEqual(['b1', 'b2'])
  })
})

describe('toOpenLabel', () => {
  test.each([
    [token(), 'Open token for grants-ui'],
    [token({ clientId: null }), 'Open token with no client ID']
  ])('names the token and its client', (given, label) => {
    expect(toOpenLabel(given)).toBe(label)
  })
})

describe('toActions', () => {
  test.each([
    [
      'an active token',
      token(),
      {
        rotate: true,
        rotateLocked: false,
        expiry: true,
        revoke: true,
        delete: false
      }
    ],
    [
      'the token in use',
      token({ inUse: true }),
      {
        rotate: true,
        rotateLocked: false,
        expiry: true,
        revoke: false,
        delete: false
      }
    ],
    [
      'a revoked token',
      revoked,
      {
        rotate: true,
        rotateLocked: true,
        expiry: true,
        revoke: false,
        delete: true
      }
    ],
    [
      'an expired token',
      expired,
      {
        rotate: true,
        rotateLocked: true,
        expiry: true,
        revoke: false,
        delete: true
      }
    ],
    [
      'a token with no valid name',
      token({ clientId: null }),
      {
        rotate: false,
        rotateLocked: false,
        expiry: false,
        revoke: false,
        delete: false
      }
    ]
  ])('offers %s what the design draws', (_name, given, actions) => {
    expect(toActions(given)).toEqual(actions)
  })
})

describe('toTokenRows', () => {
  const [row] = toTokenRows([token({ expiresAt: inDays(89) })], now)

  test('draws one row per token, sorted', () => {
    const rows = toTokenRows(
      [revoked, token({ clientId: 'alpha', tokenId: 'c1' })],
      now
    )

    expect(rows.map(({ tokenId }) => tokenId)).toEqual(['c1', revoked.tokenId])
  })

  test('says when an active token expires, and Never for none', () => {
    expect(row.expires).toEqual({
      text: '1 Feb 2027',
      instant: inDays(89)
    })
    expect(toTokenRows([token()], now)[0].expires).toEqual({
      text: 'Never',
      instant: null
    })
  })

  test('says a past expiry as a plain date, as the status says it has ended', () => {
    expect(toTokenRows([expired], now)[0].expires.text).toBe('2 Nov 2026')
  })

  test('offers no Revoke on the token in use, which the service refuses anyway, by inUse alone', () => {
    const rows = toTokenRows(
      [
        token({ inUse: true }),
        token({ tokenId: 'other', clientId: 'fg-grants-platform-admin' })
      ],
      now
    )
    const [inUse, platform] = [token().tokenId, 'other'].map(
      (id) => rows.find(({ tokenId }) => tokenId === id)!
    )

    expect(inUse.actions.revoke).toBe(false)
    expect(inUse.actions.rotate).toBe(true)
    expect(inUse.actions.expiry).toBe(true)
    expect(platform.actions.revoke).toBe(true)
  })

  test('lists Client ID, Expires and Token, with no relative time', () => {
    expect(row.facts).toEqual([
      { id: 'client', label: 'Client ID', text: 'grants-ui' },
      {
        id: 'expires',
        label: 'Expires',
        text: '1 Feb 2027',
        instant: inDays(89)
      },
      { id: 'token', label: 'Token', text: null, hint: 'x7Qa' }
    ])
  })

  test('names no one who created or revoked a token in the facts', () => {
    const text = JSON.stringify(toTokenRows([revoked], now)[0].facts)

    expect(text).not.toContain('Sam Revoker')
    expect(text).not.toContain('Alex Operator')
  })

  test('shows the stored document exactly as the service sent it, pretty-printed', () => {
    const stored = {
      _id: { $oid: revoked.tokenId },
      id: 'a1b••••••f2c',
      client: 'grants-ui',
      clientId: 'grants-ui',
      revokedAt: { $date: '2026-11-01T09:00:00Z' },
      revokedBy: 'Sam Revoker'
    }

    expect(toTokenRows([{ ...revoked, stored }], now)[0].document).toBe(
      JSON.stringify(stored, null, 2)
    )
  })

  test('says why an action is missing', () => {
    expect(row.actionNote).toBeNull()
    expect(toTokenRows([revoked], now)[0].actionNote).toBe(
      'This token no longer works. Change its expiry to bring it back, or delete it.'
    )
    expect(toTokenRows([token({ clientId: null })], now)[0].actionNote).toBe(
      "This token has no valid client ID, so it can't be changed here."
    )
    expect(toTokenRows([token({ inUse: true })], now)[0].actionNote).toBeNull()
  })

  test("knows a client's last token", () => {
    const rows = toTokenRows(
      [revoked, token(), token({ clientId: 'solo', tokenId: 'solo1' })],
      now
    )

    expect(rows.map(({ lastToken }) => lastToken)).toEqual([false, false, true])
  })
})
