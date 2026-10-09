import type { Request } from '@hapi/hapi'

export { toGasActor } from '../gas-actor.ts'

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
 * Who is asking, as the backend's audit record should name them.
 * Kept as a standalone export for code and tests that only need the display name.
 */
export const toActor = (request: Request): string | undefined =>
  toIdentifier(toSessionUser(request.auth.credentials.user)) || undefined

/** The Entra object id GAS records as the audit `user`; `undefined` sends no header. */
export const toActorId = (request: Request): string | undefined =>
  toTrimmed(toSessionUser(request.auth.credentials?.user).id) || undefined
