import type { Server } from '@hapi/hapi'

import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { viewDevOpsRoute } from './routes/view-dev-ops.route.ts'
import { viewEventsRoute } from './routes/view-events.route.ts'
import { devOpsViewOptions } from './view-options.ts'

export const devOps = {
  plugin: {
    name: 'dev-ops',
    register(server: Server) {
      server.views({
        ...devOpsViewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })

      server.route(
        scopedTo('FCP.GrantOperationsAdmin', [viewDevOpsRoute, viewEventsRoute])
      )
    }
  }
}
