import type { Server } from '@hapi/hapi'

import { asOperator } from '../common/as-operator.ts'
import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { viewOptions } from '../server/plugins/views/index.ts'
import {
  changeClaimableItemRoute,
  updateClaimableItemRoute
} from './routes/change-claimable-item.route.ts'
import {
  createClaimableItemRoute,
  newClaimableItemRoute
} from './routes/new-claimable-item.route.ts'
import {
  replaceAllowListRoute,
  resetAllowListRoute,
  viewAllowListRoute
} from './routes/allow-list.route.ts'
import { saveGrantSettingsRoute } from './routes/grant-settings.route.ts'
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
        scopedTo(
          'FCP.GrantApplicationsAdmin',
          asOperator([
            viewGrantOpsRoute,
            viewAllowListRoute,
            resetAllowListRoute,
            replaceAllowListRoute,
            saveGrantSettingsRoute,
            viewClaimsRoute,
            newClaimableItemRoute,
            createClaimableItemRoute,
            changeClaimableItemRoute,
            updateClaimableItemRoute
          ])
        )
      )
    }
  }
}
