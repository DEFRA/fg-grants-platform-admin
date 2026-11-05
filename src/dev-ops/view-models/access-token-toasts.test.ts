import type { TokenNotice, ToastPart } from './access-token-toasts.ts'
import {
  toFailureOutcome,
  toRefusalMessage,
  toToast
} from './access-token-toasts.ts'

const notice = (fields: Partial<TokenNotice> = {}): TokenNotice => ({
  service: 'gas',
  action: 'revoke',
  outcome: 'done',
  errorCode: null,
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  hint: 'x7Qa',
  expiresAt: null,
  ...fields
})

/** As a sighted reader sees it, the hint masked. */
const said = (parts: ToastPart[] = []): string =>
  parts
    .map((part) => ('hint' in part ? `••••${part.hint}` : part.text))
    .join('')

describe('toFailureOutcome', () => {
  test.each([
    [{ outcome: 'unreachable' }, 'unreachable', null],
    [{ outcome: 'unknown' }, 'unknown', null],
    [{ outcome: 'unchecked' }, 'unchecked', null],
    [
      { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' },
      'not-found',
      'API_TOKEN_NOT_FOUND'
    ],
    [
      { outcome: 'refused', statusCode: 409, errorCode: 'API_TOKEN_IN_USE' },
      'refused',
      'API_TOKEN_IN_USE'
    ],
    [
      { outcome: 'refused', statusCode: 409, errorCode: 'API_TOKEN_DUPLICATE' },
      'refused',
      'API_TOKEN_DUPLICATE'
    ],
    [
      { outcome: 'refused', statusCode: 403, errorCode: null },
      'rejected',
      null
    ],
    [
      { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' },
      'unreachable',
      'CW_UNREACHABLE'
    ]
  ] as const)('reads %j as %s', (failure, outcome, errorCode) => {
    expect(toFailureOutcome(failure)).toEqual({ outcome, errorCode })
  })
})

describe('toToast', () => {
  test.each([
    [{ action: 'issue' }, 'Token for grants-ui is live'],
    [{ action: 'rotate' }, 'Token for grants-ui is live'],
    [{ action: 'revoke' }, 'Token revoked — grants-ui gets 401 from now on'],
    [{ action: 'delete' }, 'Token deleted — grants-ui ••••x7Qa'],
    [{ action: 'delete', hint: null }, 'Token deleted — grants-ui'],
    [
      { action: 'expiry', expiresAt: '2027-02-01T23:59:59.000Z' },
      'Expiry updated — expires 1 Feb 2027'
    ],
    [{ action: 'expiry', expiresAt: null }, 'Expiry updated — never expires']
  ] as const)("says a success %j in the design's words", (fields, text) => {
    const toast = toToast(notice(fields), 'gas')

    expect(toast?.role).toBe('success')
    expect(said(toast?.parts)).toBe(text)
  })

  test('keeps the hint apart, so the page can mask it', () => {
    expect(toToast(notice({ action: 'delete' }), 'gas')?.parts).toContainEqual({
      hint: 'x7Qa'
    })
  })

  test.each([
    [
      'revoke',
      'API_TOKEN_NOT_ACTIVE',
      'gas',
      'Not revoked — this token is no longer active. Nothing has changed.'
    ],
    [
      'rotate',
      'API_TOKEN_NOT_ACTIVE',
      'gas',
      'Not rotated — this token is no longer active. Nothing has changed.'
    ],
    ['delete', 'API_TOKEN_ACTIVE', 'gas', 'Not deleted. Nothing has changed.'],
    [
      'revoke',
      'API_TOKEN_IN_USE',
      'gas',
      'Not revoked — Grants Platform Admin is calling GAS with this token. Rotate it instead. Nothing has changed.'
    ],
    [
      'revoke',
      'API_TOKEN_IN_USE',
      'cw',
      'Not revoked — fg-gas-backend is calling CW-BE with this token. Rotate it instead. Nothing has changed.'
    ],
    [
      'rotate',
      'API_TOKEN_IN_USE',
      'gas',
      'Not rotated — this is the token GPA is calling with. Choose Keep valid until end of tomorrow or Keep valid for 7 days, to end of day. Nothing has changed.'
    ],
    [
      'rotate',
      'API_TOKEN_IN_USE',
      'cw',
      'Not rotated — this is the token GAS is calling CW-BE with. Choose Keep valid until end of tomorrow or Keep valid for 7 days, to end of day. Nothing has changed.'
    ],
    [
      'expiry',
      'API_TOKEN_IN_USE',
      'gas',
      "Not changed — this is the token GPA is calling with, so it can't expire now. Nothing has changed."
    ],
    [
      'expiry',
      'API_TOKEN_IN_USE',
      'cw',
      "Not changed — this is the token GAS is calling CW-BE with, so it can't expire now. Nothing has changed."
    ],
    [
      'delete',
      'API_TOKEN_IN_USE',
      'gas',
      'Not deleted — fg-gas-backend refused the request. Nothing has changed.'
    ]
  ] as const)(
    'says a refused %s, %s, on %s',
    (action, errorCode, service, text) => {
      const toast = toToast(
        notice({ service, action, outcome: 'refused', errorCode }),
        service
      )

      expect(toast?.role).toBe('error')
      expect(said(toast?.parts)).toBe(text)
    }
  )

  test.each([
    [
      'not-found',
      'gas',
      'error',
      'Not revoked — fg-gas-backend no longer has this token. Nothing has changed.'
    ],
    [
      'not-found',
      'cw',
      'error',
      'Not revoked — CW-BE no longer has this token. Nothing has changed.'
    ],
    [
      'unreachable',
      'cw',
      'error',
      'Not revoked — fg-gas-backend could not be reached. Nothing has changed.'
    ],
    [
      'rejected',
      'cw',
      'error',
      'Not revoked — CW-BE refused the request. Nothing has changed.'
    ],
    [
      'rejected',
      'gas',
      'error',
      'Not revoked — fg-gas-backend refused the request. Nothing has changed.'
    ],
    ['unknown', 'gas', 'warning', 'Revoke status unknown — refresh to check.']
  ] as const)('says a %s revoke on %s', (outcome, service, role, text) => {
    const toast = toToast(notice({ service, outcome }), service)

    expect(toast?.role).toBe(role)
    expect(said(toast?.parts)).toBe(text)
  })

  test.each([
    [
      'issue',
      'New token status unknown — refresh to check. If it was issued, revoke it: its value is gone.'
    ],
    [
      'rotate',
      'Rotation status unknown — refresh to check. If a new token was issued, revoke it: its value is gone.'
    ],
    ['expiry', 'Expiry change status unknown — refresh to check.'],
    ['delete', 'Delete status unknown — refresh to check.']
  ] as const)(
    'warns that a %s may or may not have happened',
    (action, text) => {
      expect(
        said(toToast(notice({ action, outcome: 'unknown' }), 'gas')?.parts)
      ).toBe(text)
    }
  )

  test('says a refusal in the words of the dialog it is shown in', () => {
    expect(
      toRefusalMessage(
        notice({
          action: 'delete',
          outcome: 'refused',
          errorCode: 'API_TOKEN_ACTIVE'
        })
      )
    ).toBe('Not deleted. Nothing has changed.')
  })

  test('says a new token was not sent when the list to check it against could not be read', () => {
    const toast = toToast(
      notice({ action: 'issue', outcome: 'unchecked' }),
      'gas'
    )

    expect(toast?.role).toBe('error')
    expect(said(toast?.parts)).toBe(
      'Not issued — fg-gas-backend could not list the tokens to check this client. Nothing has changed.'
    )
  })

  test("says nothing on the other service's page", () => {
    expect(toToast(notice({ service: 'cw' }), 'gas')).toBeNull()
  })

  test('says nothing without a notice', () => {
    expect(toToast(undefined, 'gas')).toBeNull()
  })
})
