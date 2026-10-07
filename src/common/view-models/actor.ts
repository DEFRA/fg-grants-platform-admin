import type { Request } from '@hapi/hapi'
import type { GasActor } from '../gas-actor.ts'

/** What the session may say of its user: a token this app does not issue, so every field is checked where it is read. */
export interface SessionUser {
  id?: unknown
  name?: unknown
  email?: unknown
}

/** The session's user, or an empty one when it carries none. */
export const toSessionUser = (user: unknown): SessionUser =>
  typeof user === 'object' && user !== null ? (user as SessionUser) : {}

/** A string, trimmed; anything else is nothing. */
export const toTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** The name, or the email, or nothing at all. */
export const toIdentifier = (user: SessionUser): string =>
  toTrimmed(user.name) || toTrimmed(user.email)

/**
 * Who is asking, as the backend's audit record should name them: the only
 * identity on the request is this app's service token, which four operators
 * share, so the signed in user travels alongside it on `x-actor`. The name
 * first, the email when there is no name — an Entra ID token can carry either.
 *
 * `undefined` when the session carries neither, which sends no header at all
 * rather than an empty one: a blank `x-actor` would be a claim that nobody
 * asked. The write still happens — an operator is not turned away from a
 * queue because their token was issued without a name on it.
 */
export const toActor = (request: Request): string | undefined =>
  toIdentifier(toSessionUser(request.auth.credentials.user)) || undefined

/** The Entra object id GAS records as the audit `user`; `undefined` sends no header. */
export const toActorId = (request: Request): string | undefined =>
  toTrimmed(toSessionUser(request.auth.credentials?.user).id) || undefined

export const toGasActor = (request: Request): GasActor => ({
  name: toActor(request),
  id: toActorId(request)
})
