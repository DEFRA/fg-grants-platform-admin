import type { Server } from '@hapi/hapi'

import { devOpsSignedOutPath } from '../server/plugins/auth/paths.ts'
import { scopedTo } from '../server/plugins/auth/scoped-to.ts'
import { asOperator } from '../common/as-operator.ts'
import { config } from '../common/config.ts'
import { roles } from '../common/roles.ts'
import {
  accessTokenWriteRoutes,
  viewAccessTokensRoute
} from './routes/access-tokens.route.ts'
import {
  searchBucketRoute,
  viewBucketRoute
} from './routes/bucket-list.route.ts'
import {
  fetchGrantDefinitionsRoute,
  fetchWorkflowDefinitionRoute
} from './routes/fetch-definitions.route.ts'
import {
  downloadExploreRoute,
  downloadJsonRoute
} from './routes/download-explore.route.ts'
import { runExploreRoute, viewExploreRoute } from './routes/explore.route.ts'
import { viewOverviewRoute } from './routes/overview.route.ts'
import { eventResultRoute } from './routes/event-result.route.ts'
import { eventStatusRoute } from './routes/event-status.route.ts'
import { purgeEventRoute } from './routes/purge-event.route.ts'
import {
  viewApplicationRoute,
  viewCaseRoute,
  viewCurrentGrantRoute,
  viewCurrentWorkflowRoute,
  viewGrantRoute,
  viewWorkflowRoute
} from './routes/record-pages.route.ts'
import { redriveEventRoute } from './routes/redrive-event.route.ts'
import { reviewPayloadRoute } from './routes/review-payload.route.ts'
import { savePayloadRoute } from './routes/save-payload.route.ts'
import { viewEventRoute } from './routes/view-event.route.ts'
import { saveTimesRoute, viewTimesRoute } from './routes/times.route.ts'
import { toSignedOutRoute } from './routes/signed-out.route.ts'
import { fetchMissingShell } from './shell-fallback.ts'
import { provideExploreRunsStore } from './repositories/explore-runs.repository.ts'
import { toStatusResponse } from './status-pages.ts'
import { countUpstream, guardOneCall } from './upstream.ts'
import { timesCookieName } from './view-models/times.ts'
import { compileComponentMacros, devOpsViewOptions } from './view-options.ts'

const daysInYear = 365
const yearMs = daysInYear * 24 * 60 * 60 * 1000

/** The Times setting, kept a year like the theme; only the server reads it. */
const timesCookieOptions = {
  ttl: yearMs,
  path: '/',
  isSecure: config.get('session.cookie.secure'),
  isHttpOnly: true,
  isSameSite: 'Strict' as const,
  encoding: 'none' as const,
  clearInvalid: true,
  ignoreErrors: true
}

export const devOps = {
  plugin: {
    name: 'dev-ops',
    register(server: Server) {
      server.views({
        ...devOpsViewOptions,
        relativeTo: import.meta.dirname,
        path: 'views'
      })
      compileComponentMacros()

      server.state(timesCookieName, timesCookieOptions)
      provideExploreRunsStore(server)

      // Before the CSP plugin, so the page it draws in place of an error gets the header too.
      server.ext('onPreResponse', fetchMissingShell, {
        sandbox: 'plugin',
        before: ['errors', 'blankie']
      })
      server.ext('onPreResponse', toStatusResponse, {
        sandbox: 'plugin',
        before: ['errors', 'blankie']
      })
      server.ext('onPreResponse', guardOneCall, { sandbox: 'plugin' })

      server.route(toSignedOutRoute(devOpsSignedOutPath))

      server.route(
        scopedTo(
          roles.grantOperationsAdmin,
          asOperator(
            countUpstream([
              viewOverviewRoute,
              viewExploreRoute,
              viewBucketRoute,
              viewApplicationRoute,
              viewCaseRoute,
              viewGrantRoute,
              viewCurrentGrantRoute,
              viewWorkflowRoute,
              viewCurrentWorkflowRoute,
              viewEventRoute,
              eventStatusRoute,
              eventResultRoute,
              viewAccessTokensRoute,
              viewTimesRoute,
              runExploreRoute,
              downloadExploreRoute,
              downloadJsonRoute,
              searchBucketRoute,
              fetchGrantDefinitionsRoute,
              fetchWorkflowDefinitionRoute,
              redriveEventRoute,
              purgeEventRoute,
              reviewPayloadRoute,
              savePayloadRoute,
              ...accessTokenWriteRoutes,
              saveTimesRoute
            ])
          )
        )
      )
    }
  }
}
