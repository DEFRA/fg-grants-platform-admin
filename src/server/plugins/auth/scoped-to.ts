import type { ServerRoute } from '@hapi/hapi'

/**
 * Scopes an area's routes to one app role, as named on the Entra ID
 * application registration. Hapi turns away a user without it, so a handler
 * only ever runs for one who holds it.
 *
 * Applied across an area's routes at registration, so a new endpoint on its
 * sub-paths is scoped by default rather than remembering to ask. A route may
 * still name its own auth, which is left alone.
 */
export const scopedTo = (scope: string, routes: ServerRoute[]): ServerRoute[] =>
  routes.map((route) => ({
    ...route,
    options: {
      auth: { strategy: 'session', scope: [scope] },
      ...route.options
    }
  }))
