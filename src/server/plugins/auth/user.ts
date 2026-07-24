/**
 * The signed in user.
 *
 * Every field is required, so deciding what an absent Entra ID claim means is
 * the caller's job, in ./session.ts, rather than the rest of the app's.
 *
 * Constructed fresh on every request rather than stored in the session, because
 * yar serialises to Redis as JSON and would hand back a plain object with the
 * prototype gone.
 */
export class User {
  id: string
  email: string
  name: string

  // The app roles assigned to the user on the Entra ID application
  // registration.
  roles: string[]

  constructor({ id, email, name, roles }: User) {
    this.id = id
    this.email = email
    this.name = name
    this.roles = roles
  }
}
