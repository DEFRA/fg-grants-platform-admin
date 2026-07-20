import type { Request, ResponseToolkit } from '@hapi/hapi'

import { roles } from '#/server/auth/roles.ts'
import { sessionStrategyName } from '#/server/auth/session-strategy.ts'

/**
 * Mirrors /operations-admin, but gated on the applications admin role instead of the
 * operations admin role.
 */
export const applicationsAdminController = {
  options: {
    auth: {
      strategy: sessionStrategyName,
      scope: [roles.grantApplicationsAdmin]
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    return h.view('applications-admin/index', {
      pageTitle: 'Applications Admin',
      heading: 'Applications Admin',
      displayName: request.auth.credentials.profile.displayName,
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Applications Admin'
        }
      ]
    })
  }
}
