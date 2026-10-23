import type { Server } from '@hapi/hapi'

import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { asOperator } from '../common/as-operator.ts'
import {
  searchBucketRoute,
  viewBucketRoute,
  viewDevOpsRoute
} from './routes/bucket-list.route.ts'
import { fetchGrantDefinitionsRoute } from './routes/fetch-definitions.route.ts'
import { purgeEventRoute } from './routes/purge-event.route.ts'
import {
  viewApplicationRoute,
  viewCaseRoute,
  viewCurrentGrantRoute,
  viewGrantRoute
} from './routes/record-pages.route.ts'
import { redriveEventRoute } from './routes/redrive-event.route.ts'
import { reviewPayloadRoute } from './routes/review-payload.route.ts'
import { savePayloadRoute } from './routes/save-payload.route.ts'
import { viewEventRoute } from './routes/view-event.route.ts'
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
            viewBucketRoute,
            searchBucketRoute,
            viewApplicationRoute,
            viewCaseRoute,
            viewGrantRoute,
            viewCurrentGrantRoute,
            fetchGrantDefinitionsRoute,
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
