import type { Request, ResponseToolkit } from '@hapi/hapi'

import { roles } from '#/server/auth/roles.ts'
import { sessionStrategyName } from '#/server/auth/session-strategy.ts'

/**
 * Hapi turns away anyone whose Entra ID roles claim is missing the operations
 * admin role, so the handler only ever runs for a user who holds it.
 */
export const operationsAdminController = {
  options: {
    auth: {
      strategy: sessionStrategyName,
      scope: [roles.grantOperationsAdmin]
    }
  },
  handler(request: Request, h: ResponseToolkit) {
    return h.view('operations-admin/index', {
      pageTitle: 'Operations Admin',
      heading: 'Operations Admin',
      displayName: request.auth.credentials.profile.displayName,
      breadcrumbs: [
        {
          text: 'Home',
          href: '/'
        },
        {
          text: 'Operations Admin'
        }
      ]
    })
  }
}
