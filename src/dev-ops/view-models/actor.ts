import type { Request } from '@hapi/hapi'

/**
 * Who is asking, as the backend's audit record should name them.
 *
 * Every write this app makes is somebody's decision — a redrive puts a message
 * back on a live queue — and until now all fg-gas-backend could record was that
 * `fg-grants-platform-admin` did it, because the only identity on the request
 * is this app's service token. That is a true statement about the token and a
 * useless one about the decision: four operators share it.
 *
 * So the signed in user travels alongside it on `x-actor`. The name first,
 * because it is what an operator reading an audit trail recognises, and the
 * email when there is no name — an Entra ID token can carry either, and a
 * record naming somebody by their email is far better than one naming nobody.
 *
 * `undefined` when the session carries neither, which sends no header at all
 * rather than an empty one: a blank `x-actor` would be a claim that nobody
 * asked, which is a different thing from not saying who did. The backend still
 * has the token, and the write still happens — an operator is not turned away
 * from a queue because their token was issued without a name on it.
 */
/**
 * Defensive about the field as well as the value: the type says both are
 * strings, and the type is a promise about a token this app does not issue.
 */
const toTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** The name, or the email, or nothing at all. */
const toIdentifier = (user: { name?: string; email?: string }): string =>
  toTrimmed(user.name) || toTrimmed(user.email)

export const toActor = (request: Request): string | undefined => {
  const user = request.auth.credentials.user as
    | { name?: string; email?: string }
    | undefined

  return user === undefined ? undefined : toIdentifier(user) || undefined
}
