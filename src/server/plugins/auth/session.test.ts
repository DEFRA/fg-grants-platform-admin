import type { Request } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'

import { User } from './user.ts'
import {
  clearAuthSession,
  getAuthSession,
  setAuthSession,
  toCredentials
} from './session.ts'

// Stands in for yar, which answers with null for a key it is not holding.
const requestWithSession = (stored?: unknown) => {
  const store = new Map<string, unknown>()

  if (stored !== undefined) {
    store.set('auth', stored)
  }

  return {
    yar: {
      set: (key: string, value: unknown) => store.set(key, value),
      get: (key: string) => store.get(key) ?? null,
      clear: (key: string) => store.delete(key)
    }
  } as unknown as Request
}

const tokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  idToken: 'id-token'
}

const sessionWithClaims = (claims: object): OidcToken =>
  ({ ...tokens, claims }) as unknown as OidcToken

describe('setAuthSession', () => {
  test('stores the tokens and claims', () => {
    const request = requestWithSession()

    setAuthSession(request, sessionWithClaims({ oid: 'user-id' }))

    expect(getAuthSession(request)).toEqual({
      ...tokens,
      claims: { oid: 'user-id' }
    })
  })

  test('keeps everything else the provider returned out of the session', () => {
    const request = requestWithSession()

    setAuthSession(request, {
      ...sessionWithClaims({ oid: 'user-id' }),
      expiresIn: 3600,
      tokenType: 'Bearer'
    } as unknown as OidcToken)

    expect(getAuthSession(request)).toEqual({
      ...tokens,
      claims: { oid: 'user-id' }
    })
  })
})

describe('getAuthSession', () => {
  test('answers undefined when no user is signed in', () => {
    expect(getAuthSession(requestWithSession())).toBeUndefined()
  })
})

describe('clearAuthSession', () => {
  test('drops the session, leaving no user signed in', () => {
    const request = requestWithSession(sessionWithClaims({ oid: 'user-id' }))

    clearAuthSession(request)

    expect(getAuthSession(request)).toBeUndefined()
  })
})

describe('toCredentials', () => {
  test('builds the user from the Entra ID claims', () => {
    const { user } = toCredentials(
      sessionWithClaims({
        oid: 'user-id',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        roles: ['FCP.GrantOperationsAdmin']
      })
    )

    expect(user).toBeInstanceOf(User)
    expect(user).toEqual({
      id: 'user-id',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      roles: ['FCP.GrantOperationsAdmin']
    })
  })

  test('exposes the roles as the scope hapi checks a route against', () => {
    const { scope } = toCredentials(
      sessionWithClaims({
        oid: 'user-id',
        roles: ['FCP.GrantOperationsAdmin', 'FCP.GrantApplicationsAdmin']
      })
    )

    expect(scope).toEqual([
      'FCP.GrantOperationsAdmin',
      'FCP.GrantApplicationsAdmin'
    ])
  })

  test('falls back to empty strings for the claims Entra ID left out', () => {
    const { user } = toCredentials(sessionWithClaims({ oid: 'user-id' }))

    expect(user).toEqual({
      id: 'user-id',
      email: '',
      name: '',
      roles: []
    })
  })

  test('grants no scope to a user holding no roles', () => {
    expect(toCredentials(sessionWithClaims({ oid: 'user-id' })).scope).toEqual(
      []
    )
  })

  test('grants no scope when the roles claim is not a list', () => {
    const { user, scope } = toCredentials(
      sessionWithClaims({ oid: 'user-id', roles: 'FCP.GrantOperationsAdmin' })
    )

    expect(user.roles).toEqual([])
    expect(scope).toEqual([])
  })

  test('survives a token carrying no claims', () => {
    const { user, scope } = toCredentials(tokens as unknown as OidcToken)

    expect(user).toEqual({ id: undefined, email: '', name: '', roles: [] })
    expect(scope).toEqual([])
  })
})
