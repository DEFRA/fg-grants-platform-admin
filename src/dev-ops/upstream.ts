import type {
  Lifecycle,
  Request,
  ResponseToolkit,
  ServerRoute
} from '@hapi/hapi'
import { AsyncLocalStorage } from 'node:async_hooks'

import type { Shell } from './repositories/shell.repository.ts'

/** What one request has asked GAS: every call it made, and the shell the last answer that carried one sent. */
export interface Upstream {
  calls: number
  shell: Shell | null
}

const storage = new AsyncLocalStorage<Upstream>()

/** Null outside a Dev Ops request, so a call made for anything else is neither counted nor kept. */
export const currentUpstream = (): Upstream | null => storage.getStore() ?? null

/** The request's store, made the first time any part of it asks. */
export const upstreamOf = (request: Request): Upstream => {
  request.app.upstream ??= { calls: 0, shell: null }

  return request.app.upstream
}

/** Every GAS call made inside `work` is counted against the request. */
export const withUpstream = <T>(request: Request, work: () => T): T =>
  storage.run(upstreamOf(request), work)

type Method = (
  this: unknown,
  request: Request,
  h: ResponseToolkit,
  error?: Error
) => Lifecycle.ReturnValue

const counted = (method: Method): Method =>
  function (this: unknown, request, h, error) {
    return withUpstream(request, () => method.call(this, request, h, error))
  }

/** Counts every GAS call a route's handler makes against its request. */
export const countUpstream = (routes: ServerRoute[]): ServerRoute[] =>
  routes.map((route) => ({
    ...route,
    handler: counted(route.handler as Method) as Lifecycle.Method
  }))

/** Told the route, as method and path pattern, of a request that made more than one call. */
export type ExtraCallsHandler = (request: Request, route: string) => void

const warn: ExtraCallsHandler = (request, route) => {
  request.logger.warn(`${route} made more than one call to fg-gas-backend`)
}

const guard = { onExtraCalls: warn }

/** Tests swap in a handler that fails the response. */
export const setExtraCallsHandler = (
  handler: ExtraCallsHandler | null
): void => {
  guard.onExtraCalls = handler ?? warn
}

export const toRouteKey = ({ route }: Request): string =>
  `${route.method.toUpperCase()} ${route.path}`

export const guardOneCall = (request: Request, h: ResponseToolkit) => {
  if ((request.app.upstream?.calls ?? 0) > 1) {
    guard.onExtraCalls(request, toRouteKey(request))
  }

  return h.continue
}
