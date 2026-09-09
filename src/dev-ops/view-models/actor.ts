import type { Request } from '@hapi/hapi'

/**
 * Defensive about the field as well as the value: the type says both are
 * strings, and the type is a promise about a token this app does not issue.
 */
const toTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** The name, or the email, or nothing at all. */
const toIdentifier = (user: { name?: string; email?: string }): string =>
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
export const toActor = (request: Request): string | undefined => {
  const user = request.auth.credentials.user as
    | { name?: string; email?: string }
    | undefined

  return user === undefined ? undefined : toIdentifier(user) || undefined
}
