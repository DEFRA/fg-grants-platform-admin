import type { Server } from '@hapi/hapi'

import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { viewOptions } from '../server/plugins/views/index.ts'
import { viewClaimsRoute } from './routes/view-claims.route.ts'
import { viewGrantOpsRoute } from './routes/view-grant-ops.route.ts'

export const grantOps = {
  plugin: {
    name: 'grant-ops',
    register(server: Server) {
      server.views({
        ...viewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })

      server.route(
        scopedTo('FCP.GrantApplicationsAdmin', [
          viewGrantOpsRoute,
          viewClaimsRoute
        ])
      )
    }
  }
}
