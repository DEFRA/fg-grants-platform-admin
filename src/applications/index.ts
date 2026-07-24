import type { Server } from '@hapi/hapi'

import { viewOptions } from '../server/plugins/views/index.ts'
import { viewApplicationsRoute } from './routes/view-applications.route.ts'

export const applications = {
  plugin: {
    name: 'applications',
    register(server: Server) {
      server.views({
        ...viewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })

      server.route(viewApplicationsRoute)
    }
  }
}
