import { EJSON } from 'bson'

import { logger } from '../../common/logger.ts'
import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import type { ReadToken } from './access-token-rows.ts'
import {
  toActions,
  toCompareTokens,
  toReadList,
  toTokenRows,
  toTokenState,
  tokenStates
} from './access-token-rows.ts'
import { serviceWords } from './access-token-services.ts'
import { readBase64 } from './explore-bson.ts'
import { storedToken, storedTokenDocument } from '../use-cases/test-fixtures.ts'

vi.mock(import('../../common/logger.ts'))

const now = new Date('2026-11-04T13:50:00.000Z')
const hour = 3_600_000
const day = 24 * hour

const after = (ms: number): string => new Date(now.getTime() + ms).toISOString()

const listedToken = (fields: Partial<ListedToken> = {}): ListedToken => ({
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
  document: storedTokenDocument(),
  ...fields
})

const token = (fields: Partial<ListedToken> = {}): ReadToken => {
  const listed = listedToken(fields)

  return { ...listed, stored: readBase64(listed.document) }
}

const words = serviceWords.gas

describe('toTokenState', () => {
  test.each([
    ['active', token(), 'active'],
    [
      'active, and GAS says expiring soon',
      token({ expiringSoon: true }),
      'expiring'
    ],
    [
      'active, a day left, and GAS says not yet expiring soon',
      token({ expiresAt: after(day) }),
      'active'
    ],
    [
      'expired',
      token({ status: 'EXPIRED', expiresAt: after(-day) }),
      'expired'
    ],
    ['revoked', token({ status: 'REVOKED', expiresAt: after(-day) }), 'revoked']
  ] as const)('%s is %s', (_name, given, state) => {
    expect(toTokenState(given)).toBe(state)
  })

  test('each state has the prototype’s word and tone', () => {
    expect(tokenStates).toEqual({
      active: { text: 'Active', tone: 'success' },
      expiring: { text: 'Expiring soon', tone: 'warning' },
      expired: { text: 'Expired', tone: 'neutral' },
      revoked: { text: 'Revoked', tone: 'danger' }
    })
  })
})

describe('toActions', () => {
  test.each([
    ['active', { rotate: true, expiry: true, revoke: true, delete: false }],
    ['expiring', { rotate: true, expiry: true, revoke: true, delete: false }],
    ['expired', { rotate: false, expiry: true, revoke: false, delete: true }],
    ['revoked', { rotate: false, expiry: false, revoke: false, delete: true }]
  ] as const)(
    'a %s token has the actions the services allow it',
    (state, actions) => {
      expect(toActions(token(), state)).toEqual(actions)
    }
  )

  test('a row with no valid client ID has none: no route can address it', () => {
    expect(toActions(token({ clientId: null }), 'active')).toEqual({
      rotate: false,
      expiry: false,
      revoke: false,
      delete: false
    })
  })
})

describe('toCompareTokens', () => {
  test('sorts by client, then expiring, working and dead, then newest; unnamed rows last', () => {
    const rows = [
      token({ tokenId: 'a', clientId: null }),
      token({ tokenId: 'b', status: 'REVOKED' }),
      token({ tokenId: 'c', createdAt: '2026-10-01T00:00:00.000Z' }),
      token({ tokenId: 'd' }),
      token({ tokenId: 'e', expiringSoon: true }),
      token({ tokenId: 'f', clientId: 'apply' })
    ]

    expect(
      rows.toSorted(toCompareTokens).map(({ tokenId }) => tokenId)
    ).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
  })
})

describe('a token’s expiry', () => {
  const expiresOn = (expiresAt: string) =>
    toTokenRows([token({ expiresAt })], words)[0].expires

  test('writes the UK day, and its title the second and zone the token stops at', () => {
    expect(expiresOn('2027-02-04T23:59:59.000Z')).toEqual({
      datetime: '2027-02-04T23:59:59Z',
      text: '4\u00a0Feb 2027',
      title: '4 Feb 2027 23:59:59 GMT'
    })
  })

  test('in summer the UK end of day is 22:59:59 UTC, written as its UK day', () => {
    expect(expiresOn('2027-07-04T22:59:59.000Z')).toEqual({
      datetime: '2027-07-04T22:59:59Z',
      text: '4\u00a0Jul 2027',
      title: '4 Jul 2027 23:59:59 BST'
    })
  })

  test('an instant in the first hour of a UK summer day is that UK day, not the UTC day before', () => {
    expect(expiresOn('2027-05-30T23:59:59.000Z')).toEqual({
      datetime: '2027-05-30T23:59:59Z',
      text: '31\u00a0May 2027',
      title: '31 May 2027 00:59:59 BST'
    })
  })
})

describe('toTokenRows', () => {
  test('carries what the list and the drawer show', () => {
    const [row] = toTokenRows(
      [token({ expiresAt: '2027-02-04T23:59:59.000Z', inUse: true })],
      words
    )

    expect(row).toMatchObject({
      tokenId: '6650c1f2a9e4b1d07c20bd91',
      clientId: 'grants-ui',
      hint: 'x7Qa',
      state: 'active',
      status: { text: 'Active', tone: 'success' },
      expires: { text: '4\u00a0Feb 2027', title: '4 Feb 2027 23:59:59 GMT' },
      inUse: true,
      revokeOff: 'Dev Ops is calling GAS with this token. Rotate it instead.'
    })
    expect(row.doc).toMatchObject({
      t: 'object',
      entries: expect.arrayContaining([
        ['_id', { t: 'objectId', v: '6650c1f2a9e4b1d07c20bd91' }],
        ['id', { t: 'string', v: 'a1b••••••f2c' }],
        [
          'createdAt',
          {
            t: 'date',
            v: String(Date.parse(storedToken.createdAt.toISOString()))
          }
        ],
        ['expiresAt', { t: 'null' }]
      ])
    })
    expect(EJSON.parse(row.ejson, { relaxed: false })).toEqual(storedToken)
    expect(row.ejson).toContain('"createdAt":{"$date":{"$numberLong":')
  })

  test('a token that never expires has no time, and only the token in use has Revoke off', () => {
    const [row] = toTokenRows([token()], words)

    expect(row.expires).toBeNull()
    expect(row.revokeOff).toBeNull()
  })

  test('on CW, the token in use is the one GAS calls with', () => {
    const [row] = toTokenRows([token({ inUse: true })], serviceWords.cw)

    expect(row.revokeOff).toBe(
      'GAS is calling CW with this token. Rotate it instead.'
    )
  })
})

describe('toReadList', () => {
  test('reads every row’s stored document', () => {
    const list = toReadList(
      { outcome: 'done', tokens: [listedToken(), listedToken()] },
      'gas'
    )

    expect(list).toEqual({ outcome: 'done', tokens: [token(), token()] })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('passes a list that failed on as it is', () => {
    expect(toReadList({ outcome: 'unlisted' }, 'cw')).toEqual({
      outcome: 'unlisted'
    })
  })

  test('one row that isn’t BSON makes the list unreadable, logging only the kind of failure', () => {
    const unreadable = Buffer.from('not bson').toString('base64')

    expect(
      toReadList(
        {
          outcome: 'done',
          tokens: [listedToken(), listedToken({ document: unreadable })]
        },
        'cw'
      )
    ).toEqual({ outcome: 'unreadable' })
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'A stored CW token isn’t readable as BSON: BSONOffsetError'
    )
  })
})
