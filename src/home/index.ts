import type { Server } from '@hapi/hapi'

import { viewRootRoute } from './routes/view-root.route.ts'

// Its own module because `/` answers for every area, so neither area can own
// it without knowing about the other.
export const home = {
  plugin: {
    name: 'home',
    register(server: Server) {
      server.route(viewRootRoute)
    }
  }
}
