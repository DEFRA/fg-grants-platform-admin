import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import { toAccessTokensPage } from './access-tokens-page.view-model.ts'

const now = new Date('2026-11-04T13:50:00.000Z')

const token = (fields: Partial<ListedToken> = {}): ListedToken => ({
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: 'x7Qa',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: '2027-02-01T23:59:59.000Z',
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
  expiresAt: '2026-11-01T09:00:00.000Z'
})

const page = (fields: Partial<Parameters<typeof toAccessTokensPage>[0]> = {}) =>
  toAccessTokensPage({
    service: 'gas',
    tokens: [token(), revoked],
    now,
    ...fields
  })

describe('toAccessTokensPage', () => {
  test('names the page after its service', () => {
    expect(page()).toMatchObject({
      pageTitle: 'GAS access tokens',
      navActive: 'clients-gas',
      path: '/dev-ops/clients/gas'
    })
    expect(page({ service: 'cw' }).pageTitle).toBe('CW access tokens')
  })

  test('has no list when the tokens could not be read', () => {
    expect(page({ tokens: null }).list).toBeNull()
  })

  test("addresses each token's dialogs by its client and id", () => {
    const [row] = page().list!.rows

    expect(row.dialogs.revoke.action).toBe(
      '/dev-ops/clients/gas/grants-ui/tokens/6650c1f2a9e4b1d07c20bd91/revoke'
    )
    expect(row.dialogs.rotate.sameExpiry).toBe('1 Feb 2027')
  })

  test("starts an expiry change on the token's own date, or Never, as the design does", () => {
    const [working, ended] = page().list!.rows
    const never = page({ tokens: [{ ...revoked, expiresAt: null }] }).list!
      .rows[0]
    const chosen = (row: typeof working) =>
      row.dialogs.expiry.picker.choices.find(({ checked }) => checked)?.value

    expect(chosen(working)).toBe('custom')
    expect(working.dialogs.expiry.picker.date).toBe('2027-02-01')
    expect(chosen(ended)).toBe('custom')
    expect(ended.dialogs.expiry.picker.summary).toBe(
      'Pick a date in the future.'
    )
    expect(chosen(never)).toBe('never')
  })

  test('defaults a new token to 90 days', () => {
    expect(page().list!.newToken.picker.summary).toBe('Expires 2 Feb 2027.')
  })

  test('counts the working tokens of each client for New token to warn with', () => {
    expect(
      JSON.parse(
        page({
          tokens: [
            token(),
            token({ tokenId: 'b' }),
            revoked,
            token({ clientId: null })
          ]
        }).list!.newToken.activeCounts
      )
    ).toEqual({ 'grants-ui': 2 })
  })

  test('opens the dialog a POST came back for, and its token in the drawer, with what was typed and what was wrong', () => {
    const shown = page({
      dialog: {
        kind: 'revoke',
        tokenId: '6650c1f2a9e4b1d07c20bd91',
        values: { confirm: 'grants' },
        errors: { confirm: "That doesn't match." }
      }
    })
    const [row, other] = shown.list!.rows

    expect(shown.openTokenId).toBe('6650c1f2a9e4b1d07c20bd91')
    expect(row.dialogs.revoke).toMatchObject({
      open: true,
      value: 'grants',
      error: "That doesn't match."
    })
    expect(row.dialogs.expiry.open).toBe(false)
    expect(other.dialogs.revoke.open).toBe(false)
    expect(shown.list!.newToken.open).toBe(false)
  })

  test('opens New token again with what was typed and what was wrong', () => {
    const { newToken } = page({
      dialog: {
        kind: 'new',
        tokenId: null,
        values: { clientId: 'Bad', expiry: 'custom', date: '' },
        errors: { clientId: 'Use lowercase.', expiry: 'Enter a date.' }
      }
    }).list!

    expect(newToken).toMatchObject({
      open: true,
      clientId: 'Bad',
      clientError: 'Use lowercase.'
    })
    expect(newToken.picker.error).toBe('Enter a date.')
  })

  test('shows the token being revealed', () => {
    const reveal = { clientId: 'grants-ui', raw: 'abcx7Qa', hint: 'x7Qa' }

    expect(page({ reveal }).reveal).toEqual(reveal)
  })

  test('posts the current expiry with an expiry change, so an untouched date keeps it', () => {
    expect(page().list!.rows[0].dialogs.expiry.current).toBe(
      '2027-02-01T23:59:59.000Z'
    )
  })

  test('opens nothing on a plain visit', () => {
    const shown = page()

    expect(shown.openTokenId).toBeNull()
    expect(shown.reveal).toBeNull()
    expect(shown.toast).toBeNull()
  })
})
