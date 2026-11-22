import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import type { ReadList, ReadToken } from './access-token-rows.ts'
import type {
  AccessTokensPageInput,
  TokenView
} from './access-tokens-page.view-model.ts'
import {
  toAccessTokensPage,
  toListStatus
} from './access-tokens-page.view-model.ts'
import { readBase64 } from './explore-bson.ts'
import { storedTokenDocument } from '../use-cases/test-fixtures.ts'

const now = new Date('2026-11-10T15:00:00.000Z')

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

const active = token()
const inUse = token({
  tokenId: '6650c1f2a9e4b1d07c20bd92',
  clientId: 'fg-grants-platform-admin',
  inUse: true
})
const revoked = token({
  tokenId: '6650c1f2a9e4b1d07c20bd93',
  clientId: 'old',
  status: 'REVOKED'
})

const page = (input: Partial<AccessTokensPageInput> = {}) =>
  toAccessTokensPage({
    service: 'gas',
    list: { outcome: 'done', tokens: [active, inUse, revoked] },
    now,
    prod: false,
    ...input
  })

const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error('Expected a value')
  }

  return value
}

const view = (p: ReturnType<typeof page>, tokenId: string): TokenView =>
  need(need(p.tokens).find((t) => t.tokenId === tokenId))

const dialogOf = <K extends 'rotate' | 'expiry' | 'revoke' | 'delete'>(
  p: ReturnType<typeof page>,
  tokenId: string,
  kind: K
) =>
  need(
    (need(view(p, tokenId)[kind]) as { dialog: unknown }).dialog
  ) as NonNullable<NonNullable<TokenView[K]>['dialog']>

const checked = (options: { value: string; checked: boolean }[]) =>
  options.find((o) => o.checked)?.value

describe('what the address opens', () => {
  test('nothing by default', () => {
    const p = page()

    expect(need(p.newToken).open).toBe(false)
    expect(need(p.tokens).every((t) => !t.open)).toBe(true)
  })

  test('a token’s drawer, and a dialog over it', () => {
    const p = page({ requested: { tokenId: active.tokenId, dialog: 'rotate' } })

    expect(view(p, active.tokenId).open).toBe(true)
    expect(dialogOf(p, active.tokenId, 'rotate').open).toBe(true)
    expect(dialogOf(p, active.tokenId, 'expiry').open).toBe(false)
  })

  test('New token, which needs no token', () => {
    expect(
      need(page({ requested: { tokenId: null, dialog: 'new' } }).newToken).open
    ).toBe(true)
  })

  test('nothing for a token the list doesn’t have', () => {
    const p = page({
      requested: { tokenId: 'ffffffffffffffffffffffff', dialog: 'rotate' }
    })

    expect(need(p.tokens).every((t) => !t.open)).toBe(true)
  })

  test('no Revoke dialog for the token in use, whatever the address asks', () => {
    const p = page({ requested: { tokenId: inUse.tokenId, dialog: 'revoke' } })

    expect(view(p, inUse.tokenId).revoke).toMatchObject({ dialog: null })
    expect(view(p, inUse.tokenId).revokeOff).toBe(
      'Dev Ops is calling GAS with this token. Rotate it instead.'
    )
  })

  test('no dialog for an action the token hasn’t got', () => {
    const p = page({
      requested: { tokenId: revoked.tokenId, dialog: 'rotate' }
    })

    expect(view(p, revoked.tokenId).rotate).toBeNull()
    expect(dialogOf(p, revoked.tokenId, 'delete').open).toBe(false)
  })
})

describe('a dialog handed back', () => {
  test('opens with what was typed and what was wrong, over its token’s drawer', () => {
    const p = page({
      dialog: {
        kind: 'expiry',
        tokenId: active.tokenId,
        values: { expiry: 'custom', date: '' },
        errors: { date: 'Enter an expiry date like 4 Feb 2027.' }
      }
    })
    const expiry = dialogOf(p, active.tokenId, 'expiry')

    expect(view(p, active.tokenId).open).toBe(true)
    expect(expiry.open).toBe(true)
    expect(expiry.errors).toEqual([
      {
        id: `token-${active.tokenId}-expiry-choice-date`,
        text: 'Enter an expiry date like 4 Feb 2027.'
      }
    ])
    expect(checked(expiry.expiry.options)).toBe('custom')
  })

  test('New token warns once about the client’s active tokens, and carries the client to go ahead with', () => {
    const p = page({
      dialog: {
        kind: 'new',
        tokenId: null,
        values: { clientId: 'grants-ui', expiry: '30', date: '' },
        errors: {},
        active: 2
      }
    })

    expect(need(p.newToken).client.warning).toBe(
      'grants-ui already has 2 active tokens. If this replaces one, rotate that token instead; to add another, issue it again.'
    )
    expect(need(p.newToken).hidden).toEqual([
      { name: 'confirmFor', value: 'grants-ui' }
    ])
    expect(checked(need(p.newToken).expiry.options)).toBe('30')
  })

  test('a refusal for a token the list no longer has becomes a toast', () => {
    const p = page({
      list: { outcome: 'done', tokens: [active] },
      dialog: {
        kind: 'delete',
        tokenId: revoked.tokenId,
        values: {},
        errors: {},
        refusal: {
          title: 'Not deleted.',
          text: 'GAS no longer has this token. Nothing has changed.'
        }
      }
    })

    expect(p.toasts).toEqual([
      {
        tone: 'danger',
        text: 'Not deleted. GAS no longer has this token. Nothing has changed.'
      }
    ])
    expect(need(p.tokens).every((t) => !t.open)).toBe(true)
  })

  test('field errors for a token the page doesn’t list become a toast', () => {
    const p = page({
      list: { outcome: 'unlisted' },
      dialog: {
        kind: 'expiry',
        tokenId: active.tokenId,
        values: { expiry: '30', date: '' },
        errors: { expiry: 'Pick today or a later date.' }
      }
    })

    expect(p.toasts).toEqual([
      {
        tone: 'danger',
        text: 'Expiry not changed. Pick today or a later date. Nothing has changed.'
      }
    ])
  })

  test('field errors for a listed token stay on its dialog, with no toast', () => {
    const p = page({
      list: { outcome: 'done', tokens: [active] },
      dialog: {
        kind: 'expiry',
        tokenId: active.tokenId,
        values: { expiry: '30', date: '' },
        errors: { expiry: 'Pick today or a later date.' }
      }
    })

    expect(p.toasts).toEqual([])
    expect(dialogOf(p, active.tokenId, 'expiry').open).toBe(true)
  })
})

describe('Change expiry starts where the token is', () => {
  test('on its date', () => {
    const dated = token({ expiresAt: '2027-02-04T23:59:59.000Z' })
    const p = page({ list: { outcome: 'done', tokens: [dated] } })
    const dialog = dialogOf(p, dated.tokenId, 'expiry')

    expect(dialog.currently).toBe('4 Feb 2027')
    expect(dialog.expiry.date).toBe('2027-02-04')
    expect(checked(dialog.expiry.options)).toBe('custom')
    expect(dialog.hidden).toEqual([{ name: 'hint', value: 'x7Qa' }])
  })

  test('on Never', () => {
    const dialog = dialogOf(page(), active.tokenId, 'expiry')

    expect(dialog.currently).toBe('never expires')
    expect(checked(dialog.expiry.options)).toBe('never')
  })
})

describe('the list', () => {
  test('couldn’t be read: no rows, the alert names who didn’t answer, New token stays', () => {
    const p = page({
      list: { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' },
      service: 'cw'
    })

    expect(p.tokens).toBeNull()
    expect(p.alerts).toEqual([
      {
        tone: 'danger',
        title: 'The tokens list couldn’t be loaded.',
        text: 'CW couldn’t be reached. Nothing has changed — try again in a moment.',
        retryHref: '/dev-ops/clients/cw',
        focusOnArrival: false
      }
    ])
    expect(p.newHref).toBe('/dev-ops/clients/cw?dialog=new')
    expect(p.newToken).not.toBeNull()
  })

  test('Token issued after a rotation leaves the old token’s drawer open, and Done goes back to it', () => {
    const p = page({
      reveal: {
        clientId: 'grants-ui',
        raw: 'r'.repeat(43),
        rotatedTokenId: active.tokenId
      }
    })

    expect(view(p, active.tokenId).open).toBe(true)
    expect(need(p.reveal).doneHref).toBe(
      `/dev-ops/clients/gas?token=${active.tokenId}`
    )
  })

  test('Done after an issue goes to the list', () => {
    expect(
      need(
        page({
          reveal: {
            clientId: 'grants-ui',
            raw: 'r'.repeat(43),
            rotatedTokenId: null
          }
        }).reveal
      ).doneHref
    ).toBe('/dev-ops/clients/gas')
  })
})

describe('toListStatus', () => {
  test.each([
    [{ outcome: 'done', tokens: [] }, 200],
    [{ outcome: 'unlisted' }, 200],
    [{ outcome: 'unknown' }, 503],
    [{ outcome: 'unreachable' }, 503],
    [{ outcome: 'refused', statusCode: 403, errorCode: null }, 503],
    [{ outcome: 'unreadable' }, 503]
  ] as [ReadList, number][])('%j: %i', (list, status) => {
    expect(toListStatus(list)).toBe(status)
  })

  test('a token issued beside a list it can’t draw is 200', () => {
    expect(toListStatus({ outcome: 'unreadable' }, true)).toBe(200)
  })
})
