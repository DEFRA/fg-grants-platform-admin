import type { Request } from '@hapi/hapi'
import { AsyncLocalStorage } from 'node:async_hooks'

/** The signed in operator, as GAS's audit names them: a display name and their Entra object id. */
export interface GasActor {
  name?: string
  id?: string
  cwRoles?: string[] | null
}

const storage = new AsyncLocalStorage<GasActor>()

/** Every GAS call made inside `work` goes as this operator. */
export const asGasActor = <T>(actor: GasActor, work: () => T): T =>
  storage.run(actor, work)

/** Nobody outside a request: a background call names no operator. */
export const currentGasActor = (): GasActor => storage.getStore() ?? {}

/** Node refuses header values outside U+0020–U+00FF. */
const HEADER_SAFE = /^[\u0020-\u00ff]*$/

/** RFC 8187-encoded only when a name like `Łukasz` would not fit a header; GAS decodes the prefix. */
export const toHeaderActor = (actor: string): string =>
  HEADER_SAFE.test(actor) ? actor : `UTF-8''${encodeURIComponent(actor)}`

/** Defensive about the field as well as the value. */
const toTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** The name, or the email, or nothing at all. */
const toIdentifier = (user: { name?: string; email?: string }): string =>
  toTrimmed(user.name) || toTrimmed(user.email)

type CredentialsUser = {
  id?: string
  name?: string
  email?: string
  cwRoles?: string[] | null
}

const userOf = (request: Request): CredentialsUser | undefined =>
  request.auth.credentials?.user as CredentialsUser | undefined

const nameOf = (user: CredentialsUser): string | undefined =>
  toIdentifier(user) || undefined

const idOf = (user: CredentialsUser): string | undefined =>
  toTrimmed(user.id) || undefined

/**
 * Builds a GasActor from the signed in user's credentials. Shared between
 * dev-ops and grant-ops.
 */
export const toGasActor = (request: Request): GasActor => {
  const user = userOf(request)

  return {
    name: user && nameOf(user),
    id: user && idOf(user),
    cwRoles: user?.cwRoles
  }
}
