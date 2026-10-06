import type { Server } from '@hapi/hapi'

import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { asOperator } from './as-operator.ts'
import { purgeEventRoute } from './routes/purge-event.route.ts'
import { redriveEventRoute } from './routes/redrive-event.route.ts'
import { reviewPayloadRoute } from './routes/review-payload.route.ts'
import { savePayloadRoute } from './routes/save-payload.route.ts'
import { viewApplicationRoute } from './routes/view-application.route.ts'
import {
  searchApplicationsRoute,
  viewApplicationsRoute
} from './routes/view-applications.route.ts'
import { viewDevOpsRoute } from './routes/view-dev-ops.route.ts'
import { viewEventRoute } from './routes/view-event.route.ts'
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
        scopedTo(
          'FCP.GrantOperationsAdmin',
          asOperator([
            viewDevOpsRoute,
            viewApplicationsRoute,
            searchApplicationsRoute,
            viewApplicationRoute,
            viewEventsRoute,
            viewEventRoute,
            redriveEventRoute,
            purgeEventRoute,
            reviewPayloadRoute,
            savePayloadRoute
          ])
        )
      )
    }
  }
}
