import type { Request } from '@hapi/hapi'

import { toActor } from './actor.ts'

/** A request carrying whatever the session put on it — or nothing at all. */
const asRequest = (user: unknown): Request =>
  ({ auth: { credentials: { user } } }) as unknown as Request

describe('toActor', () => {
  test('names the operator by their name', () => {
    expect(
      toActor(asRequest({ name: 'Ada Lovelace', email: 'ada@example.com' }))
    ).toBe('Ada Lovelace')
  })

  // An Entra ID token can carry either, and a record naming somebody by their
  // email is far better than one naming nobody.
  test('falls back to their email when the token carries no name', () => {
    expect(toActor(asRequest({ email: 'ada@example.com' }))).toBe(
      'ada@example.com'
    )
  })

  test('trims what it was given', () => {
    expect(toActor(asRequest({ name: '  Ada Lovelace  ' }))).toBe(
      'Ada Lovelace'
    )
  })

  // No header at all rather than an empty one: a blank `x-actor` would be a
  // claim that nobody asked, which is a different thing from not saying.
  test.each([
    ['a user with neither', {}],
    ['a name of nothing but spaces', { name: '   ', email: '' }],
    ['fields that are not strings', { name: 42, email: null }],
    ['no user on the session at all', undefined]
  ])('names nobody given %s', (_name, user) => {
    expect(toActor(asRequest(user))).toBeUndefined()
  })
})
