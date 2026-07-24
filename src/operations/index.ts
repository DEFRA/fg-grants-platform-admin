import type { Server } from '@hapi/hapi'

import { viewOptions } from '../server/plugins/views/index.ts'
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

      server.route(viewOperationsRoute)
    }
  }
}
