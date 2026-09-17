import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

/**
 * The role names are copied rather than shared because `import-x/
 * no-restricted-paths` bars a route from importing them, and the repo answers
 * that by copying — see the same choice in dev-ops/routes/redrive-event.route.
 *
 * Each area's front door, not the page behind it: an area decides for itself
 * what its own root means, so moving the Dev Ops landing page is one change
 * there rather than two. That costs a hop through `/dev-ops`, which is the
 * cheaper half of the trade.
 *
 * Dev Ops leads for someone holding both roles, deliberately rather than by
 * the order their token happens to list roles in. Nobody is moved by the
 * choice — this path answered everyone with a 404 until now — so it is one to
 * revisit rather than a precedent.
 */
const areas = [
  { role: 'FCP.GrantOperationsAdmin', entrance: '/dev-ops' },
  { role: 'FCP.GrantApplicationsAdmin', entrance: '/grant-ops' }
]

/** Hapi types the credentials scope as either one role or many. */
const rolesOf = (request: Request) => [request.auth.credentials.scope].flat()

/**
 * Do not give this route a scope: anonymous has to reach sign in from here,
 * and a user with no role has to get the 404 this path has always given rather
 * than a 403 telling them a door exists.
 */
export const viewRootRoute: ServerRoute = {
  method: 'GET',
  path: '/',
  options: {
    auth: { strategy: 'session' }
  },
  handler(request: Request, h: ResponseToolkit) {
    const roles = rolesOf(request)
    const area = areas.find(({ role }) => roles.includes(role))

    if (!area) {
      throw Boom.notFound()
    }

    return h.redirect(area.entrance)
  }
}
