import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

import { roles } from '../../common/roles.ts'

/**
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
  { role: roles.grantOperationsAdmin, entrance: '/dev-ops' },
  { role: roles.grantApplicationsAdmin, entrance: '/grant-ops' }
]

/** Hapi types the credentials scope as either one role or many. */
const rolesOf = (request: Request) => [request.auth.credentials.scope].flat()

/**
 * Do not give this route a scope: anonymous has to reach sign in from here. A
 * signed in user with no role gets the refusal page, as hapi would give one
 * refused an area.
 */
export const viewRootRoute: ServerRoute = {
  method: 'GET',
  path: '/',
  options: {
    auth: { strategy: 'session' }
  },
  handler(request: Request, h: ResponseToolkit) {
    const held = rolesOf(request)
    const area = areas.find(({ role }) => held.includes(role))

    if (!area) {
      throw Boom.forbidden('Insufficient scope')
    }

    return h.redirect(area.entrance)
  }
}
