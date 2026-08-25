import type { Server } from '@hapi/hapi'

import { viewOptions } from '../server/plugins/views/index.ts'
import {
  createClaimableItemRoute,
  newClaimableItemRoute
} from './routes/new-claimable-item.route.ts'
import { viewClaimsRoute } from './routes/view-claims.route.ts'
import { viewOperationsRoute } from './routes/view-operations.route.ts'

export const operations = {
  plugin: {
    name: 'operations',
    register(server: Server) {
      server.views({
        ...viewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })

      server.route([
        viewOperationsRoute,
        viewClaimsRoute,
        newClaimableItemRoute,
        createClaimableItemRoute
      ])
    }
  }
}
